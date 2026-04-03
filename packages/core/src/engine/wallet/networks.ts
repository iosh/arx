import type { NetworkController } from "../../controllers/network/types.js";
import type { ChainActivationService } from "../../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type {
  NetworkPreferencesChangedHandler,
  NetworkPreferencesService,
} from "../../services/store/networkPreferences/types.js";
import type { WalletNetworks } from "../types.js";

// Selected namespace, active chains, and RPC preferences.
export const createWalletNetworks = (deps: {
  networkPreferences: NetworkPreferencesService;
  chainViews: ChainViewsService;
  chainActivation: ChainActivationService;
  network: NetworkController;
}): WalletNetworks => {
  const { networkPreferences, chainViews, chainActivation, network } = deps;

  return {
    getPreferences: () => networkPreferences.get(),
    getPreferencesSnapshot: () => networkPreferences.getSnapshot(),
    getSelectedNamespace: () => chainViews.getSelectedNamespace(),
    getActiveChainByNamespace: () => networkPreferences.getActiveChainByNamespace(),
    getActiveChainRef: (namespace) => networkPreferences.getActiveChainRef(namespace),
    getSelectedChainView: () => chainViews.getSelectedChainView(),
    getActiveChainViewForNamespace: (namespace) => chainViews.getActiveChainViewForNamespace(namespace),
    listKnownChainViews: () => chainViews.listKnownChainViews(),
    listAvailableChainViews: () => chainViews.listAvailableChainViews(),
    buildWalletNetworksSnapshot: () => chainViews.buildWalletNetworksSnapshot(),
    getNetworkState: () => network.getState(),
    getActiveEndpoint: (chainRef) => network.getActiveEndpoint(chainRef),
    selectWalletChain: (chainRef) => chainActivation.selectWalletChain(chainRef),
    selectWalletNamespace: (namespace) => chainActivation.selectWalletNamespace(namespace),
    activateNamespaceChain: (params) => chainActivation.activateNamespaceChain(params),
    setRpcPreferences: (rpc) => networkPreferences.setRpcPreferences(rpc),
    clearRpcPreferences: () => networkPreferences.clearRpcPreferences(),
    patchRpcPreference: (params) => networkPreferences.patchRpcPreference(params),
    setRpcStrategy: (chainRef, strategy) => {
      network.setStrategy(chainRef, strategy);
    },
    reportRpcOutcome: (chainRef, outcome) => {
      network.reportRpcOutcome(chainRef, outcome);
    },
    onStateChanged: (listener) => network.onStateChanged(listener),
    onPreferencesChanged: (listener: NetworkPreferencesChangedHandler) => networkPreferences.subscribeChanged(listener),
  };
};
