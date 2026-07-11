import { persistenceChange } from "../persistence/change.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";
import { assertNamespace } from "./caip.js";
import { ChainNotFoundError, WalletChainSelectionUnavailableError } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type { NetworksContext } from "./Networks.js";
import { ProviderChainSelectionInvalidKeyError } from "./selection/provider/errors.js";
import {
  type ProviderChainSelectionRecord,
  providerChainSelectionPersistenceType,
} from "./selection/provider/persistence.js";
import { walletChainSelectionPersistenceType } from "./selection/wallet/persistence.js";
import { selectWalletChain, selectWalletNamespace } from "./WalletChainSelection.js";

const readKey = (key: OriginNamespaceKey): OriginNamespaceKey => {
  if (!key.origin || key.origin.trim() !== key.origin) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "origin", value: key.origin });
  }
  if (!key.namespace || key.namespace.trim() !== key.namespace) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "namespace", value: key.namespace });
  }
  return key;
};

const readOrigin = (origin: string): string => {
  if (!origin || origin.trim() !== origin) {
    throw new ProviderChainSelectionInvalidKeyError({ field: "origin", value: origin });
  }
  return origin;
};

const requireAvailableChain = (networks: NetworksContext, chainRef: ChainRef): void => {
  if (!networks.definitions.get(chainRef)) throw new ChainNotFoundError();
};

export const selectChainForWallet = async (networks: NetworksContext, chainRef: ChainRef): Promise<void> => {
  await networks.mutations.run(async (commit) => {
    requireAvailableChain(networks, chainRef);
    const next = selectWalletChain(networks.walletSelection.get(), chainRef);
    await commit([persistenceChange.put(walletChainSelectionPersistenceType, next)]);
    networks.walletSelection.replace(next);
    networks.publishChanged({ walletSelection: true });
  });
};

export const selectNamespaceForWallet = async (networks: NetworksContext, namespace: string): Promise<void> => {
  await networks.mutations.run(async (commit) => {
    const chainRef = networks.walletSelection.getChainRef(namespace);
    if (!chainRef) throw new WalletChainSelectionUnavailableError(namespace);
    requireAvailableChain(networks, chainRef);
    const next = selectWalletNamespace(networks.walletSelection.get(), namespace);
    if (next.activeNamespace === networks.walletSelection.get().activeNamespace) return;
    await commit([persistenceChange.put(walletChainSelectionPersistenceType, next)]);
    networks.walletSelection.replace(next);
    networks.publishChanged({ walletSelection: true });
  });
};

export const getProviderChainSelection = async (
  networks: NetworksContext,
  input: OriginNamespaceKey,
): Promise<ProviderChainSelectionRecord | null> => await networks.readers.providerChainSelections.get(readKey(input));

export const initializeProviderChainSelection = async (
  networks: NetworksContext,
  input: OriginNamespaceKey,
): Promise<ProviderChainSelectionRecord> => {
  const key = readKey(input);
  return await networks.mutations.run(async (commit) => {
    const current = await networks.readers.providerChainSelections.get(key);
    if (current) return current;
    const chainRef = networks.walletSelection.getChainRef(key.namespace);
    if (!chainRef) throw new WalletChainSelectionUnavailableError(key.namespace);
    requireAvailableChain(networks, chainRef);
    const next: ProviderChainSelectionRecord = { ...key, chainRef };
    await commit([persistenceChange.put(providerChainSelectionPersistenceType, next)]);
    networks.publishChanged({ providerSelections: [key] });
    return next;
  });
};

export const selectChainForProvider = async (
  networks: NetworksContext,
  input: OriginNamespaceKey & { chainRef: ChainRef },
): Promise<void> => {
  const key = readKey(input);
  assertNamespace(input.chainRef, key.namespace);
  await networks.mutations.run(async (commit) => {
    requireAvailableChain(networks, input.chainRef);
    const current = await networks.readers.providerChainSelections.get(key);
    if (current?.chainRef === input.chainRef) return;
    await commit([persistenceChange.put(providerChainSelectionPersistenceType, { ...key, chainRef: input.chainRef })]);
    networks.publishChanged({ providerSelections: [key] });
  });
};

export const clearProviderChainSelection = async (
  networks: NetworksContext,
  input: OriginNamespaceKey,
): Promise<void> => {
  const key = readKey(input);
  await networks.mutations.run(async (commit) => {
    if (!(await networks.readers.providerChainSelections.get(key))) return;
    await commit([persistenceChange.remove(providerChainSelectionPersistenceType, key)]);
    networks.publishChanged({ providerSelections: [key] });
  });
};

export const clearProviderChainSelections = async (networks: NetworksContext, origin: string): Promise<void> => {
  const selectedOrigin = readOrigin(origin);
  await networks.mutations.run(async (commit) => {
    const records = await networks.readers.providerChainSelections.listByOrigin(selectedOrigin);
    if (records.length === 0) return;
    await commit(
      records.map((record) =>
        persistenceChange.remove(providerChainSelectionPersistenceType, {
          origin: record.origin,
          namespace: record.namespace,
        }),
      ),
    );
    networks.publishChanged({
      providerSelections: records.map(({ origin: recordOrigin, namespace }) => ({
        origin: recordOrigin,
        namespace,
      })),
    });
  });
};
