import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createSessionHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<
  UiHandlers,
  | "ui.session.getStatus"
  | "ui.session.unlock"
  | "ui.session.lock"
  | "ui.session.resetAutoLockTimer"
  | "ui.session.setAutoLockDuration"
> => {
  return {
    "ui.session.getStatus": async () => await deps.wallet.session.getStatus(),

    "ui.session.unlock": async ({ password }) => {
      return await deps.wallet.session.unlock({ password });
    },

    "ui.session.lock": async (payload) => {
      return await deps.wallet.session.lock(payload);
    },

    "ui.session.resetAutoLockTimer": async () => {
      return await deps.wallet.session.resetAutoLockTimer();
    },

    "ui.session.setAutoLockDuration": async ({ durationMs }) => {
      return await deps.wallet.session.setAutoLockDuration({ durationMs });
    },
  };
};
