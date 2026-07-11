import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type AutoLockSetting = Readonly<{
  durationMs: number;
}>;

export type AutoLockSettingRecord = Readonly<{
  key: "autoLock";
  value: AutoLockSetting;
}>;

export type SettingRecord = AutoLockSettingRecord;
export type SettingKey = SettingRecord["key"];
export type SettingRecordFor<TKey extends SettingKey> = Extract<SettingRecord, { key: TKey }>;

export interface SettingsReader {
  get<TKey extends SettingKey>(key: TKey): Promise<SettingRecordFor<TKey> | null>;
}

export const settingPersistenceType: KeyedPersistenceType<"setting", SettingRecord, SettingKey> =
  defineKeyedPersistenceType<"setting", SettingRecord, SettingKey>("setting");
