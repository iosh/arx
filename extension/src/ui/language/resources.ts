import type { UiLanguage } from "./languages";
import { type CommonMessages, common as enCommon } from "./locales/en/common";
import { onboarding as enOnboarding, type OnboardingMessages } from "./locales/en/onboarding";
import { wallet as enWallet, type WalletMessages } from "./locales/en/wallet";
import { common as zhCNCommon } from "./locales/zh-CN/common";
import { onboarding as zhCNOnboarding } from "./locales/zh-CN/onboarding";
import { wallet as zhCNWallet } from "./locales/zh-CN/wallet";

export const resources = {
  en: {
    common: enCommon,
    onboarding: enOnboarding,
    wallet: enWallet,
  },
  "zh-CN": {
    common: zhCNCommon,
    onboarding: zhCNOnboarding,
    wallet: zhCNWallet,
  },
} as const satisfies Record<
  UiLanguage,
  { common: CommonMessages; onboarding: OnboardingMessages; wallet: WalletMessages }
>;
