import type { UiChainsAccess, UiHandlers } from "../types.js";

export const createNetworksHandlers = (
  deps: { chains: UiChainsAccess },
  toChainSnapshot: () => {
    chainRef: string;
    chainId: string;
    namespace: string;
    displayName: string;
    shortName: string | null;
    icon: string | null;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  },
): Pick<UiHandlers, "ui.networks.switchActive"> => {
  return {
    "ui.networks.switchActive": async ({ chainRef }) => {
      await deps.chains.selectWalletChain(chainRef);
      return toChainSnapshot();
    },
  };
};
