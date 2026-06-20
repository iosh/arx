import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createBalancesHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<UiHandlers, "ui.balances.getNative"> => {
  return {
    "ui.balances.getNative": async (input) => await deps.wallet.balances.getNative(input),
  };
};
