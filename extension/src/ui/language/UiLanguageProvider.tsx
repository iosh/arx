import type { i18n as I18n } from "i18next";
import { type ReactNode, useLayoutEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { readUiLanguage, UI_LANGUAGE_STORAGE_KEY } from "./preferences";

export function UiLanguageProvider({ i18n, children }: Readonly<{ i18n: I18n; children: ReactNode }>) {
  useLayoutEffect(() => {
    const updateDocumentLanguage = (language: string) => {
      document.documentElement.lang = language;
    };
    const syncStoredLanguage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key !== UI_LANGUAGE_STORAGE_KEY && event.key !== null) return;
      void i18n.changeLanguage(readUiLanguage());
    };

    i18n.on("languageChanged", updateDocumentLanguage);
    window.addEventListener("storage", syncStoredLanguage);
    // Re-read after subscribing to include changes since document initialization.
    void i18n.changeLanguage(readUiLanguage());
    return () => {
      i18n.off("languageChanged", updateDocumentLanguage);
      window.removeEventListener("storage", syncStoredLanguage);
    };
  }, [i18n]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
