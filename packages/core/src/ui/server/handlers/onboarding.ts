import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createOnboardingHandlers = (deps: {
  wallet: TrustedWalletApi;
}): Pick<
  UiHandlers,
  | "ui.onboarding.generateMnemonic"
  | "ui.onboarding.createWalletFromMnemonic"
  | "ui.onboarding.importWalletFromMnemonic"
  | "ui.onboarding.importWalletFromPrivateKey"
> => {
  return {
    "ui.onboarding.generateMnemonic": async (input) => await deps.wallet.generateMnemonic(input),
    "ui.onboarding.createWalletFromMnemonic": async (input) => await deps.wallet.createWalletFromMnemonic(input),
    "ui.onboarding.importWalletFromMnemonic": async (input) => await deps.wallet.importWalletFromMnemonic(input),
    "ui.onboarding.importWalletFromPrivateKey": async (input) => await deps.wallet.importWalletFromPrivateKey(input),
  };
};
