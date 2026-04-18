import type { NetworkController } from "../../controllers/network/types.js";
import type { SupportedChainsController } from "../../controllers/supportedChains/types.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { CustomRpcService } from "../../services/store/customRpc/types.js";
import type { NetworkSelectionService } from "../../services/store/networkSelection/types.js";
import type { WalletNetworks } from "../types.js";

// Selected namespace, supported chains, and custom RPC overrides.
export const createWalletNetworks = (deps: {
  networkSelection: NetworkSelectionService;
  supportedChains: SupportedChainsController;
  customRpc: CustomRpcService;
  chainViews: ChainViewsService;
  chainActivation: ChainActivationService;
  network: NetworkController;
}): WalletNetworks => {
  const { networkSelection, supportedChains, customRpc, chainViews, chainActivation, network } = deps;

  return {
    getSelection: () => networkSelection.get(),
    getSelectionSnapshot: () => networkSelection.getSnapshot(),
    getSelectedNamespace: () => chainViews.getSelectedNamespace(),
    getChainRefByNamespace: () => networkSelection.getChainRefByNamespace(),
    getSelectedChainRef: (namespace) => networkSelection.getSelectedChainRef(namespace),
    getChain: (chainRef) => supportedChains.getChain(chainRef),
    listChains: () => supportedChains.listChains(),
    getSelectedChainView: () => chainViews.getSelectedChainView(),
    getActiveChainViewForNamespace: (namespace) => chainViews.getActiveChainViewForNamespace(namespace),
    listKnownChainViews: () => chainViews.listKnownChainViews(),
    listAvailableChainViews: () => chainViews.listAvailableChainViews(),
    buildWalletNetworksSnapshot: () => chainViews.buildWalletNetworksSnapshot(),
    getNetworkState: () => network.getState(),
    getRpcEndpoints: (chainRef) =>
      customRpc.getRpcEndpoints(chainRef) ?? supportedChains.getChain(chainRef)?.metadata.rpcEndpoints.slice() ?? [],
    getActiveEndpoint: (chainRef) => network.getActiveEndpoint(chainRef),
    addChain: (chain, options) => supportedChains.addChain(chain, options),
    removeChain: (chainRef) => supportedChains.removeChain(chainRef),
    setCustomRpc: async (chainRef, rpcEndpoints) => {
      await customRpc.set(chainRef, rpcEndpoints);
    },
    clearCustomRpc: async (chainRef) => {
      await customRpc.clear(chainRef);
    },
    selectChain: (chainRef) => chainActivation.selectWalletChain(chainRef),
    selectNamespace: (namespace) => chainActivation.selectWalletNamespace(namespace),
    activateNamespaceChain: (params) => chainActivation.activateNamespaceChain(params),
    setRpcStrategy: (chainRef, strategy) => {
      network.setStrategy(chainRef, strategy);
    },
    reportRpcOutcome: (chainRef, outcome) => {
      network.reportRpcOutcome(chainRef, outcome);
    },
    onStateChanged: (listener) => network.onStateChanged(listener),
    onSelectionChanged: (listener) => networkSelection.subscribeChanged(listener),
    onChainUpdated: (listener) => supportedChains.onChainUpdated(listener),
    onCustomRpcChanged: (listener) => customRpc.subscribeChanged(listener),
  };
};
