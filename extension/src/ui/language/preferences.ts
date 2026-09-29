import { storage } from "wxt/utils/storage";
import type { UiLanguage } from "./languages";

export const languagePreference = storage.defineItem<UiLanguage>("local:arx.ui.language");
