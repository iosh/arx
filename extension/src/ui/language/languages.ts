export const UI_LANGUAGES = ["en", "zh-CN"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const getBrowserLanguage = (preferredLanguages: readonly string[]): UiLanguage => {
  for (const language of preferredLanguages) {
    const locale = new Intl.Locale(language).maximize();
    if (locale.language === "en") {
      return "en";
    }
    if (locale.language === "zh" && locale.script === "Hans") {
      return "zh-CN";
    }
  }

  return "en";
};
