import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createNetworksHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<UiHandlers, "ui.networks.getSelectedChain" | "ui.networks.list" | "ui.networks.switchActive"> => {
  return {
    "ui.networks.getSelectedChain": async () => await deps.wallet.networks.getSelectedChain(),

    "ui.networks.list": async () => await deps.wallet.networks.list(),

    "ui.networks.switchActive": async (input) => {
      return await deps.wallet.networks.select(input);
    },
  };
};
