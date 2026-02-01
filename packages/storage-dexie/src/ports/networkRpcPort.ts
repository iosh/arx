import { type NetworkRpcPreferenceRecord, NetworkRpcPreferenceRecordSchema } from "@arx/core/db";
import type { NetworkRpcPort } from "@arx/core/storage";
import type { Dexie, PromiseExtended, Table } from "dexie";
import type { ArxStorageDatabase } from "../db.js";

export class DexieNetworkRpcPort implements NetworkRpcPort {
  private readonly ready: PromiseExtended<Dexie>;
  private readonly table: Table<NetworkRpcPreferenceRecord, string>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.networkRpc as unknown as Table<NetworkRpcPreferenceRecord, string>;
  }

  async get(chainRef: string): Promise<NetworkRpcPreferenceRecord | null> {
    await this.ready;
    const row = await this.table.get(chainRef);
    if (!row) return null;

    const parsed = NetworkRpcPreferenceRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid network rpc preference detected, dropping", parsed.error);
      await this.table.delete(chainRef);
      return null;
    }
    return parsed.data;
  }

  async getAll(): Promise<NetworkRpcPreferenceRecord[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const out: NetworkRpcPreferenceRecord[] = [];

    for (const row of rows) {
      const parsed = NetworkRpcPreferenceRecordSchema.safeParse(row);
      if (!parsed.success) {
        console.warn("[storage-dexie] invalid network rpc preference detected, dropping", parsed.error);
        await this.table.delete((row as any).chainRef);
        continue;
      }
      out.push(parsed.data);
    }

    out.sort((a, b) => a.chainRef.localeCompare(b.chainRef));
    return out;
  }

  async upsert(record: NetworkRpcPreferenceRecord): Promise<void> {
    await this.ready;
    const checked = NetworkRpcPreferenceRecordSchema.parse(record);
    await this.table.put(checked);
  }

  async upsertMany(records: NetworkRpcPreferenceRecord[]): Promise<void> {
    await this.ready;
    const checked = records.map((record) => NetworkRpcPreferenceRecordSchema.parse(record));
    await this.table.bulkPut(checked);
  }

  async remove(chainRef: string): Promise<void> {
    await this.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.table.clear();
  }
}
