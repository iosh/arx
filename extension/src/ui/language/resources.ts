import type { UiLanguage } from "./languages";
import { type CommonMessages, common as enCommon } from "./locales/en/common";
import { common as zhCNCommon } from "./locales/zh-CN/common";

export const resources = {
  en: {
    common: enCommon,
  },
  "zh-CN": {
    common: zhCNCommon,
  },
} as const satisfies Record<UiLanguage, { common: CommonMessages }>;
