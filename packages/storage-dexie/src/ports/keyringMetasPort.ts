import type { KeyringMetasPort } from "@arx/core/services";
import { type KeyringMetaRecord, KeyringMetaRecordSchema } from "@arx/core/storage";
import type { ArxStorageDatabase } from "../db.js";
export class DexieKeyringMetasPort implements KeyringMetasPort {
  private readonly ready: ReturnType<ArxStorageDatabase["open"]>;
  private readonly table: ArxStorageDatabase["keyringMetas"];

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.table<KeyringMetaRecord, string>("keyringMetas");
  }

  async get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null> {
    await this.ready;
    const row = await this.table.get(id);
    return await this.parseRow({ row, deleteKey: id });
  }

  async list(): Promise<KeyringMetaRecord[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const out: KeyringMetaRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow({ row, deleteKey: row.id });
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: KeyringMetaRecord): Promise<void> {
    await this.ready;
    const checked = KeyringMetaRecordSchema.parse(record);
    await this.table.put(checked);
  }
  async remove(id: KeyringMetaRecord["id"]): Promise<void> {
    await this.ready;
    await this.table.delete(id);
  }
  private async parseRow(params: {
    row: KeyringMetaRecord | undefined;
    deleteKey: KeyringMetaRecord["id"];
  }): Promise<KeyringMetaRecord | null> {
    const { row, deleteKey } = params;
    if (!row) return null;

    const parsed = KeyringMetaRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid keyring meta record, dropping", parsed.error);
      await this.table.delete(deleteKey);
      return null;
    }
    return parsed.data;
  }
}
