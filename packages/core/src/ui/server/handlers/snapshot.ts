import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createSnapshotHandlers = (deps: { wallet: TrustedWalletApi }): Pick<UiHandlers, "ui.snapshot.get"> => {
  return {
    "ui.snapshot.get": async () => deps.wallet.snapshot.get(),
  };
};
