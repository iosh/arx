import type { ChainRef } from "../../chains/ids.js";
import type { WalletNetworks } from "../../engine/types.js";
import type { SelectWalletChainInput } from "../api.js";

export const getSelectedWalletChainRefForNamespace = (
  networks: Pick<WalletNetworks, "getSelectedChainRef" | "getActiveChainViewForNamespace">,
  namespace: string,
): ChainRef => {
  return networks.getSelectedChainRef(namespace) ?? networks.getActiveChainViewForNamespace(namespace).chainRef;
};

export const createNetworksHandlers = (networks: WalletNetworks) => ({
  getSelectedChain: () => networks.getSelectedChainView(),
  list: () => networks.buildWalletNetworksSnapshot(),
  select: async (input: SelectWalletChainInput) => {
    await networks.selectChain(input.chainRef);
    return networks.getSelectedChainView();
  },
});
