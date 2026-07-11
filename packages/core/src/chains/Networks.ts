import type { PermissionRecord } from "../permissions/persistence.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { type AvailableChain, ChainDefinitions } from "./ChainDefinitions.js";
import { ChainRpc } from "./ChainRpc.js";
import type { RpcEndpoint } from "./definition.js";
import type { CustomChainRecord } from "./definitions/persistence.js";
import type { ChainRef } from "./ids.js";
import type { NetworksBootstrap } from "./networkBootstrap.js";
import { removeCustomChain, setCustomChain } from "./networkCustomChains.js";
import { clearRpcOverride, setRpcOverride } from "./networkRpcOverrides.js";
import {
  clearProviderChainSelection,
  clearProviderChainSelections,
  getProviderChainSelection,
  initializeProviderChainSelection,
  selectChainForProvider,
  selectChainForWallet,
  selectNamespaceForWallet,
} from "./networkSelections.js";
import type { NonEmptyRpcEndpoints } from "./rpc/types.js";
import type { ProviderChainSelectionRecord } from "./selection/provider/persistence.js";
import type { WalletChainSelectionRecord } from "./selection/wallet/persistence.js";
import { WalletChainSelection } from "./WalletChainSelection.js";

export type NetworksChanged = Readonly<{
  chains?: readonly ChainRef[];
  rpc?: readonly ChainRef[];
  walletSelection?: boolean;
  providerSelections?: readonly OriginNamespaceKey[];
  permissions?: readonly Pick<PermissionRecord, "origin" | "namespace">[];
}>;

export type NetworksContext = Readonly<{
  readers: Pick<CorePersistenceReaders, "providerChainSelections" | "permissions" | "transactions">;
  mutations: CoreMutationQueue;
  definitions: ChainDefinitions;
  rpc: ChainRpc;
  walletSelection: WalletChainSelection;
  /** Publishes committed network changes and must not throw. */
  publishChanged(change: NetworksChanged): void;
}>;

export type Networks = Readonly<{
  getChain(chainRef: ChainRef): AvailableChain | null;
  listChains(): readonly AvailableChain[];
  getRpcEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints;
  getWalletSelection(): WalletChainSelectionRecord;
  setCustomChain(record: CustomChainRecord): Promise<void>;
  removeCustomChain(chainRef: ChainRef): Promise<void>;
  setRpcOverride(params: { chainRef: ChainRef; endpoints: readonly RpcEndpoint[] }): Promise<void>;
  clearRpcOverride(chainRef: ChainRef): Promise<void>;
  selectChainForWallet(chainRef: ChainRef): Promise<void>;
  selectNamespaceForWallet(namespace: string): Promise<void>;
  getProviderChainSelection(key: OriginNamespaceKey): Promise<ProviderChainSelectionRecord | null>;
  initializeProviderChainSelection(key: OriginNamespaceKey): Promise<ProviderChainSelectionRecord>;
  selectChainForProvider(params: OriginNamespaceKey & { chainRef: ChainRef }): Promise<void>;
  clearProviderChainSelection(key: OriginNamespaceKey): Promise<void>;
  clearProviderChainSelections(origin: string): Promise<void>;
}>;

export const createNetworks = (params: {
  readers: NetworksContext["readers"];
  mutations: CoreMutationQueue;
  bootstrap: NetworksBootstrap;
  /** Publishes committed network changes and must not throw. */
  publishChanged(change: NetworksChanged): void;
}): Networks => {
  const definitions = new ChainDefinitions({
    builtinSeeds: params.bootstrap.builtinSeeds,
    customChains: params.bootstrap.customChains,
  });
  const rpc = new ChainRpc({
    builtinSeeds: params.bootstrap.builtinSeeds,
    customChains: params.bootstrap.customChains,
    overrides: params.bootstrap.rpcOverrides,
  });
  const walletSelection = new WalletChainSelection(params.bootstrap.walletSelection);
  const context: NetworksContext = {
    readers: params.readers,
    mutations: params.mutations,
    definitions,
    rpc,
    walletSelection,
    publishChanged: params.publishChanged,
  };

  return {
    getChain: (chainRef) => definitions.get(chainRef),
    listChains: () => definitions.list(),
    getRpcEndpoints: (chainRef) => rpc.getEndpoints(chainRef),
    getWalletSelection: () => walletSelection.get(),
    setCustomChain: (record) => setCustomChain(context, record),
    removeCustomChain: (chainRef) => removeCustomChain(context, chainRef),
    setRpcOverride: (input) => setRpcOverride(context, input),
    clearRpcOverride: (chainRef) => clearRpcOverride(context, chainRef),
    selectChainForWallet: (chainRef) => selectChainForWallet(context, chainRef),
    selectNamespaceForWallet: (namespace) => selectNamespaceForWallet(context, namespace),
    getProviderChainSelection: (key) => getProviderChainSelection(context, key),
    initializeProviderChainSelection: (key) => initializeProviderChainSelection(context, key),
    selectChainForProvider: (input) => selectChainForProvider(context, input),
    clearProviderChainSelection: (key) => clearProviderChainSelection(context, key),
    clearProviderChainSelections: (origin) => clearProviderChainSelections(context, origin),
  };
};
