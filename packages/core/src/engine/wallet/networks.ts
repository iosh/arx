import type { ChainRpcReader } from "../../chains/rpc/types.js";
import type { ChainDefinitionsService } from "../../chains/runtime/chainDefinitions/types.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { ChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/types.js";
import type { WalletChainSelectionService } from "../../services/store/walletChainSelection/types.js";
import type { WalletNetworks } from "../types.js";

// Selected namespace, supported chains, and chain RPC controls.
export const createWalletNetworks = (deps: {
  walletChainSelection: WalletChainSelectionService;
  chainDefinitions: ChainDefinitionsService;
  chainRpcEndpointOverrides: ChainRpcEndpointOverridesService;
  chainViews: ChainViewsService;
  chainActivation: ChainActivationService;
  chainRpc: ChainRpcReader;
}): WalletNetworks => {
  const { walletChainSelection, chainDefinitions, chainRpcEndpointOverrides, chainViews, chainActivation, chainRpc } =
    deps;

  return {
    getSelection: () => walletChainSelection.get(),
    getSelectionSnapshot: () => walletChainSelection.getSnapshot(),
    getSelectedNamespace: () => chainViews.getSelectedNamespace(),
    getChainRefByNamespace: () => walletChainSelection.getChainRefByNamespace(),
    getSelectedChainRef: (namespace) => walletChainSelection.getSelectedChainRef(namespace),
    getChain: (chainRef) => chainDefinitions.getChain(chainRef),
    listChains: () => chainDefinitions.getChains(),
    getSelectedChainView: () => chainViews.getSelectedChainView(),
    findAvailableChainView: (params) => chainViews.findAvailableChainView(params),
    getActiveChainViewForNamespace: (namespace) => chainViews.getActiveChainViewForNamespace(namespace),
    listKnownChainViews: () => chainViews.listKnownChainViews(),
    listAvailableChainViews: () => chainViews.listAvailableChainViews(),
    buildWalletNetworksSnapshot: () => chainViews.buildWalletNetworksSnapshot(),
    getChainRpcState: () => chainRpc.getState(),
    getRpcEndpoints: (chainRef) => chainRpc.getEndpoints(chainRef),
    addChain: (chain, options) => chainDefinitions.upsertCustomChain(chain, options),
    removeChain: (chainRef) => chainDefinitions.removeCustomChain(chainRef),
    setChainRpcEndpointOverride: async (chainRef, rpcEndpoints) => {
      await chainRpcEndpointOverrides.setEndpointOverride(chainRef, rpcEndpoints);
    },
    clearChainRpcEndpointOverride: async (chainRef) => {
      await chainRpcEndpointOverrides.clearEndpointOverride(chainRef);
    },
    selectChain: (chainRef) => chainActivation.selectWalletChain(chainRef),
    selectNamespace: (namespace) => chainActivation.selectWalletNamespace(namespace),
    activateNamespaceChain: (params) => chainActivation.activateNamespaceChain(params),
    onStateChanged: (listener) => chainRpc.onStateChanged(listener),
    onSelectionChanged: (listener) => walletChainSelection.subscribeChanged(listener),
    onChainUpdated: (listener) => chainDefinitions.onChainUpdated(listener),
    onChainRpcEndpointOverridesChanged: (listener) => chainRpcEndpointOverrides.subscribeChanged(listener),
  };
};
