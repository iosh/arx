import type { SelectWalletChainInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiChainsSchemas } from "../schemas/chains.js";

export const getSelectedWalletChainRefForNamespace = (context: WalletApiContext, namespace: string): string => {
  try {
    const selectedChain = context.networks.getSelectedChainView();
    if (selectedChain.namespace === namespace) {
      return selectedChain.chainRef;
    }
  } catch {
    // Fall back to the namespace-specific wallet chain when the global selection is not available yet.
  }

  return context.networks.getActiveChainViewForNamespace(namespace).chainRef;
};

export const getSelectedWalletChain = (context: WalletApiContext) => context.networks.getSelectedChainView();

export const listWalletNetworks = (context: WalletApiContext) => context.networks.buildWalletNetworksSnapshot();

export const selectWalletChain = async (context: WalletApiContext, input: SelectWalletChainInput) => {
  const params = WalletApiChainsSchemas.selectWalletChain.parse(input);
  await context.networks.selectChain(params.chainRef);
  return context.networks.getSelectedChainView();
};
