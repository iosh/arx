import type { UiHandlers, UiRuntimeDeps } from "../types.js";
import { extendConnectedOriginsToChain } from "./lib.js";

export const createNetworksHandlers = (
  deps: Pick<UiRuntimeDeps, "controllers">,
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
      const selected = await deps.controllers.network.switchChain(chainRef);
      await extendConnectedOriginsToChain(deps.controllers, {
        namespace: selected.namespace,
        chainRef: selected.chainRef,
      });
      return toChainSnapshot();
    },
  };
};
