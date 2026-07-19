import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export const AUTO_LOCK_SETTING_KEY = "autoLock" as const;

export type AutoLockSetting = Readonly<{
  key: typeof AUTO_LOCK_SETTING_KEY;
  durationMs: number;
}>;

export type SettingRecord = AutoLockSetting;
export type SettingKey = SettingRecord["key"];
export type SettingRecordFor<TKey extends SettingKey> = Extract<SettingRecord, { key: TKey }>;

export interface SettingsReader {
  get<TKey extends SettingKey>(key: TKey): Promise<SettingRecordFor<TKey> | null>;
}

export const settingPersistenceType: KeyedPersistenceType<"setting", SettingRecord, SettingKey> =
  defineKeyedPersistenceType<"setting", SettingRecord, SettingKey>("setting");
