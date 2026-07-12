import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import { addCustomChain, type CustomChainInput, removeCustomChain, updateCustomChain } from "./customChains.js";
import type { RpcEndpoint } from "./definition.js";
import { type AvailableChain, ChainDefinitions } from "./definitions.js";
import type { ChainRef } from "./ids.js";
import type { WalletChainSelectionRecord } from "./persistence.js";
import type { NonEmptyRpcEndpoints } from "./rpc/types.js";
import { ChainRpc } from "./rpc.js";
import { clearRpcOverride, setRpcOverride } from "./rpcOverrides.js";
import { WalletChainSelection } from "./selection.js";
import { selectChainForWallet, selectNamespaceForWallet } from "./walletSelectionCommands.js";

export type NetworksChanged = Readonly<{
  chains?: readonly ChainRef[];
  rpc?: readonly ChainRef[];
  walletSelection?: boolean;
}>;

export type NetworksContext = Readonly<{
  mutations: CoreMutationQueue;
  definitions: ChainDefinitions;
  rpc: ChainRpc;
  walletSelection: WalletChainSelection;
  now(): number;
  /** Publishes committed network changes and must not throw. */
  publishChanged(change: NetworksChanged): void;
}>;

export type Networks = Readonly<{
  getChain(chainRef: ChainRef): AvailableChain | null;
  listChains(): readonly AvailableChain[];
  getRpcEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints;
  getWalletSelection(): WalletChainSelectionRecord;
  addCustomChain(input: CustomChainInput): Promise<void>;
  updateCustomChain(input: CustomChainInput): Promise<void>;
  removeCustomChain(chainRef: ChainRef): Promise<void>;
  setRpcOverride(params: { chainRef: ChainRef; endpoints: readonly RpcEndpoint[] }): Promise<void>;
  clearRpcOverride(chainRef: ChainRef): Promise<void>;
  selectChainForWallet(chainRef: ChainRef): Promise<void>;
  selectNamespaceForWallet(namespace: string): Promise<void>;
}>;

export const createNetworks = (params: {
  mutations: CoreMutationQueue;
  bootstrap: NetworksBootstrap;
  now?: () => number;
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
    mutations: params.mutations,
    definitions,
    rpc,
    walletSelection,
    now: params.now ?? Date.now,
    publishChanged: params.publishChanged,
  };

  return {
    getChain: (chainRef) => definitions.get(chainRef),
    listChains: () => definitions.list(),
    getRpcEndpoints: (chainRef) => rpc.getEndpoints(chainRef),
    getWalletSelection: () => walletSelection.get(),
    addCustomChain: (input) => addCustomChain(context, input),
    updateCustomChain: (input) => updateCustomChain(context, input),
    removeCustomChain: (chainRef) => removeCustomChain(context, chainRef),
    setRpcOverride: (input) => setRpcOverride(context, input),
    clearRpcOverride: (chainRef) => clearRpcOverride(context, chainRef),
    selectChainForWallet: (chainRef) => selectChainForWallet(context, chainRef),
    selectNamespaceForWallet: (namespace) => selectNamespaceForWallet(context, namespace),
  };
};
