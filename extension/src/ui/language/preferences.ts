import { getBrowserLanguage, type UiLanguage } from "./languages";

export const UI_LANGUAGE_STORAGE_KEY = "arx.ui.language";

export function readUiLanguage(): UiLanguage {
  try {
    const preference = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY) as UiLanguage | null;
    if (preference !== null) return preference;
  } catch (error) {
    console.warn("Could not read the UI language preference.", error);
  }
  return getBrowserLanguage(navigator.languages);
}
