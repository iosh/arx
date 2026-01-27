import type { SettingsRecord } from "../../db/records.js";

export interface SettingsPort {
  get(): Promise<SettingsRecord | null>;
  put(record: SettingsRecord): Promise<void>;
}
