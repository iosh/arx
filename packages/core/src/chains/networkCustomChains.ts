import { removeChainFromPermissions } from "../permissions/permissionRecord.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import { getChainRefNamespace } from "./caip.js";
import { type ChainDefinition, cloneChainDefinition, validateChainDefinition } from "./definition.js";
import { type CustomChainRecord, customChainPersistenceType } from "./definitions/persistence.js";
import { ChainDefinitionConflictError, CustomChainNotFoundError, CustomChainRemovalRejectedError } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type { NetworksContext } from "./Networks.js";
import { assertNonEmptyRpcEndpoints } from "./rpc/config.js";
import { chainRpcOverridePersistenceType } from "./rpc/endpointOverrides/persistence.js";
import { providerChainSelectionPersistenceType } from "./selection/provider/persistence.js";

const ACTIVE_TRANSACTION_STATUSES = ["submitting", "broadcasting", "submitted"] as const;

const createCustomChainRecord = (record: CustomChainRecord): CustomChainRecord => {
  const definition: ChainDefinition = cloneChainDefinition(validateChainDefinition(record.definition));
  return {
    definition,
    defaultRpcEndpoints: assertNonEmptyRpcEndpoints(definition.chainRef, record.defaultRpcEndpoints),
  };
};

export const setCustomChain = async (networks: NetworksContext, input: CustomChainRecord): Promise<void> => {
  const record = createCustomChainRecord(input);
  const chainRef = record.definition.chainRef;
  if (networks.definitions.isBuiltin(chainRef)) throw new ChainDefinitionConflictError(chainRef);

  await networks.mutations.run(async (commit) => {
    await commit([persistenceChange.put(customChainPersistenceType, record)]);
    networks.definitions.replaceCustom(record);
    networks.rpc.replaceCustomDefaults(record);
    networks.publishChanged({ chains: [chainRef], rpc: [chainRef] });
  });
};

export const removeCustomChain = async (networks: NetworksContext, chainRef: ChainRef): Promise<void> => {
  await networks.mutations.run(async (commit) => {
    if (!networks.definitions.getCustom(chainRef)) throw new CustomChainNotFoundError(chainRef);
    const namespace = getChainRefNamespace(chainRef);
    if (networks.walletSelection.getChainRef(namespace) === chainRef) {
      throw new CustomChainRemovalRejectedError(chainRef, "wallet_selected");
    }
    if (
      await networks.readers.transactions.existsByChainRefAndStatuses({
        chainRef,
        statuses: ACTIVE_TRANSACTION_STATUSES,
      })
    ) {
      throw new CustomChainRemovalRejectedError(chainRef, "active_transaction");
    }

    const [providerSelections, permissions] = await Promise.all([
      networks.readers.providerChainSelections.listByChainRef(chainRef),
      networks.readers.permissions.listReferencingChainRef(chainRef),
    ]);
    const nextPermissions = removeChainFromPermissions(permissions, chainRef);
    const hadOverride = networks.rpc.getOverride(chainRef) !== null;
    await commit([
      persistenceChange.remove(customChainPersistenceType, chainRef),
      ...(hadOverride ? [persistenceChange.remove(chainRpcOverridePersistenceType, chainRef)] : []),
      ...providerSelections.map((selection) =>
        persistenceChange.remove(providerChainSelectionPersistenceType, {
          origin: selection.origin,
          namespace: selection.namespace,
        }),
      ),
      ...nextPermissions.map((permission) => persistenceChange.put(permissionPersistenceType, permission)),
    ]);
    networks.definitions.removeCustom(chainRef);
    networks.rpc.removeCustomChain(chainRef);
    networks.publishChanged({
      chains: [chainRef],
      rpc: [chainRef],
      providerSelections: providerSelections.map(({ origin, namespace }) => ({ origin, namespace })),
      permissions: permissions.map(({ origin, namespace }) => ({ origin, namespace })),
    });
  });
};
