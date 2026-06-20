import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createNetworksHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<UiHandlers, "ui.networks.switchActive"> => {
  return {
    "ui.networks.switchActive": async (input) => {
      return await deps.wallet.selectWalletChain(input);
    },
  };
};
