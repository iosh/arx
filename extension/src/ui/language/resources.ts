import type { UiLanguage } from "./languages";
import { type CommonMessages, common as enCommon } from "./locales/en/common";
import { onboarding as enOnboarding, type OnboardingMessages } from "./locales/en/onboarding";
import { common as zhCNCommon } from "./locales/zh-CN/common";
import { onboarding as zhCNOnboarding } from "./locales/zh-CN/onboarding";

export const resources = {
  en: {
    common: enCommon,
    onboarding: enOnboarding,
  },
  "zh-CN": {
    common: zhCNCommon,
    onboarding: zhCNOnboarding,
  },
} as const satisfies Record<UiLanguage, { common: CommonMessages; onboarding: OnboardingMessages }>;
