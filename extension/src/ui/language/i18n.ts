import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { UI_LANGUAGES, type UiLanguage } from "./languages";
import { resources } from "./resources";

export const createUiI18n = (language: UiLanguage) => {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    lng: language,
    supportedLngs: [...UI_LANGUAGES],
    load: "currentOnly",
    fallbackLng: false,
    resources,
    defaultNS: "common",
    ns: ["common", "onboarding", "wallet"],
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return i18n;
};
