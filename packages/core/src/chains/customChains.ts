import { persistenceChange } from "../persistence/change.js";
import { getChainRefNamespace } from "./caip.js";
import { type ChainDefinition, cloneChainDefinition, validateChainDefinition } from "./definition.js";
import {
  ChainDefinitionConflictError,
  CustomChainAlreadyExistsError,
  CustomChainNotFoundError,
  CustomChainRemovalRejectedError,
} from "./errors.js";
import type { ChainRef } from "./ids.js";
import type { NetworksContext } from "./networks.js";
import {
  type CustomChainRecord,
  chainRpcOverridePersistenceType,
  customChainPersistenceType,
} from "./persistence.js";
import { assertNonEmptyRpcEndpoints } from "./rpc/config.js";

export type CustomChainInput = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: CustomChainRecord["defaultRpcEndpoints"];
}>;

const createCustomChainRecord = (input: CustomChainInput, createAt: number): CustomChainRecord => {
  const definition: ChainDefinition = cloneChainDefinition(validateChainDefinition(input.definition));
  return {
    definition,
    defaultRpcEndpoints: assertNonEmptyRpcEndpoints(definition.chainRef, input.defaultRpcEndpoints),
    createAt,
  };
};

export const addCustomChain = async (networks: NetworksContext, input: CustomChainInput): Promise<void> => {
  const record = createCustomChainRecord(input, networks.now());
  const chainRef = record.definition.chainRef;

  await networks.mutations.run(async (commit) => {
    if (networks.definitions.isBuiltin(chainRef)) throw new ChainDefinitionConflictError(chainRef);
    if (networks.definitions.getCustom(chainRef)) throw new CustomChainAlreadyExistsError(chainRef);
    await commit([persistenceChange.put(customChainPersistenceType, record)]);
    networks.definitions.replaceCustom(record);
    networks.rpc.replaceCustomDefaults(record);
    networks.publishChanged({ chains: [chainRef], rpc: [chainRef] });
  });
};

export const updateCustomChain = async (networks: NetworksContext, input: CustomChainInput): Promise<void> => {
  const chainRef = input.definition.chainRef;
  await networks.mutations.run(async (commit) => {
    const current = networks.definitions.getCustom(chainRef);
    if (!current) throw new CustomChainNotFoundError(chainRef);
    const record = createCustomChainRecord(input, current.createAt);
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
    const selected = networks.walletSelection.getChainRef(namespace) === chainRef;
    if (selected) throw new CustomChainRemovalRejectedError(chainRef, "wallet_selected");
    const hadOverride = networks.rpc.getOverride(chainRef) !== null;
    await commit([
      persistenceChange.remove(customChainPersistenceType, chainRef),
      ...(hadOverride ? [persistenceChange.remove(chainRpcOverridePersistenceType, chainRef)] : []),
    ]);
    networks.definitions.removeCustom(chainRef);
    networks.rpc.removeCustomChain(chainRef);
    networks.publishChanged({
      chains: [chainRef],
      rpc: [chainRef],
    });
  });
};
