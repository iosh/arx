import type { ChainRpcReader } from "../../chains/rpc/types.js";
import type { SupportedChainsService } from "../../chains/runtime/supportedChains/types.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { ChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/types.js";
import type { WalletChainSelectionService } from "../../services/store/walletChainSelection/types.js";
import type { WalletNetworks } from "../types.js";

// Selected namespace, supported chains, and chain RPC controls.
export const createWalletNetworks = (deps: {
  walletChainSelection: WalletChainSelectionService;
  supportedChains: SupportedChainsService;
  chainRpcEndpointOverrides: ChainRpcEndpointOverridesService;
  chainViews: ChainViewsService;
  chainActivation: ChainActivationService;
  chainRpc: ChainRpcReader;
}): WalletNetworks => {
  const { walletChainSelection, supportedChains, chainRpcEndpointOverrides, chainViews, chainActivation, chainRpc } =
    deps;

  return {
    getSelection: () => walletChainSelection.get(),
    getSelectionSnapshot: () => walletChainSelection.getSnapshot(),
    getSelectedNamespace: () => chainViews.getSelectedNamespace(),
    getChainRefByNamespace: () => walletChainSelection.getChainRefByNamespace(),
    getSelectedChainRef: (namespace) => walletChainSelection.getSelectedChainRef(namespace),
    getChain: (chainRef) => supportedChains.getChain(chainRef),
    listChains: () => supportedChains.listChains(),
    getSelectedChainView: () => chainViews.getSelectedChainView(),
    getActiveChainViewForNamespace: (namespace) => chainViews.getActiveChainViewForNamespace(namespace),
    listKnownChainViews: () => chainViews.listKnownChainViews(),
    listAvailableChainViews: () => chainViews.listAvailableChainViews(),
    buildWalletNetworksSnapshot: () => chainViews.buildWalletNetworksSnapshot(),
    getChainRpcState: () => chainRpc.getState(),
    getRpcEndpoints: (chainRef) => chainRpc.getEndpoints(chainRef),
    addChain: (chain, options) => supportedChains.addChain(chain, options),
    removeChain: (chainRef) => supportedChains.removeChain(chainRef),
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
    onChainUpdated: (listener) => supportedChains.onChainUpdated(listener),
    onChainRpcEndpointOverridesChanged: (listener) => chainRpcEndpointOverrides.subscribeChanged(listener),
  };
};
