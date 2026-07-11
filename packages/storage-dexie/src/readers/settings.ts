import type { SettingKey, SettingRecordFor, SettingsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createSettingsReader = (context: DexiePersistenceContext): SettingsReader => ({
  async get<TKey extends SettingKey>(key: TKey): Promise<SettingRecordFor<TKey> | null> {
    await context.ready;
    const row = await context.db.settings.get(key);
    return (row as SettingRecordFor<TKey> | undefined) ?? null;
  },
});
