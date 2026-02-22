import type { SettingsRecord } from "../../storage/records.js";

export interface SettingsPort {
  get(): Promise<SettingsRecord | null>;
  put(record: SettingsRecord): Promise<void>;
}
