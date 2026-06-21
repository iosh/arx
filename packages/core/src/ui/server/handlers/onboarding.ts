import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createOnboardingHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<
  UiHandlers,
  | "ui.onboarding.getStatus"
  | "ui.onboarding.generateMnemonic"
  | "ui.onboarding.createWalletFromMnemonic"
  | "ui.onboarding.importWalletFromMnemonic"
  | "ui.onboarding.importWalletFromPrivateKey"
> => {
  return {
    "ui.onboarding.getStatus": async () => deps.wallet.onboarding.getStatus(),
    "ui.onboarding.generateMnemonic": async (input) => await deps.wallet.onboarding.generateMnemonic(input),
    "ui.onboarding.createWalletFromMnemonic": async (input) =>
      await deps.wallet.onboarding.createWalletFromMnemonic(input),
    "ui.onboarding.importWalletFromMnemonic": async (input) =>
      await deps.wallet.onboarding.importWalletFromMnemonic(input),
    "ui.onboarding.importWalletFromPrivateKey": async (input) =>
      await deps.wallet.onboarding.importWalletFromPrivateKey(input),
  };
};
