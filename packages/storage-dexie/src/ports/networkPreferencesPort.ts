import { type NetworkPreferencesRecord, NetworkPreferencesRecordSchema } from "@arx/core/db";
import type { NetworkPreferencesPort } from "@arx/core/services";
import type { Dexie, PromiseExtended, Table } from "dexie";
import type { ArxStorageDatabase } from "../db.js";

export class DexieNetworkPreferencesPort implements NetworkPreferencesPort {
  private readonly ready: PromiseExtended<Dexie>;
  private readonly table: Table<NetworkPreferencesRecord, string>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.networkPreferences as unknown as Table<NetworkPreferencesRecord, string>;
  }

  async get(): Promise<NetworkPreferencesRecord | null> {
    await this.ready;
    const row = await this.table.get("network-preferences");
    if (!row) return null;

    const parsed = NetworkPreferencesRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid network preferences detected, dropping", parsed.error);
      await this.table.delete("network-preferences");
      return null;
    }
    return parsed.data;
  }

  async put(record: NetworkPreferencesRecord): Promise<void> {
    await this.ready;
    const checked = NetworkPreferencesRecordSchema.parse(record);
    await this.table.put(checked);
  }
}
