import { persistenceChange } from "../persistence/change.js";
import { ChainNotFoundError, WalletChainSelectionUnavailableError } from "./errors.js";
import type { ChainRef } from "./ids.js";
import type { NetworksContext } from "./networks.js";
import { walletChainSelectionPersistenceType } from "./persistence.js";
import { selectWalletChain, selectWalletNamespace } from "./selection.js";

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
