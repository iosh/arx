import { eventTopic } from "../../../messenger/index.js";
import type { SettingsChangedPayload } from "./types.js";

export const SETTINGS_STORE_CHANGED = eventTopic<SettingsChangedPayload>("store:settings:changed");
