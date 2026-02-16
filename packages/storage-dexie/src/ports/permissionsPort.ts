import { type PermissionRecord, PermissionRecordSchema } from "@arx/core/db";
import type { PermissionsPort } from "@arx/core/services";
import type { ArxStorageDatabase } from "../db.js";
export class DexiePermissionsPort implements PermissionsPort {
  private readonly ready: ReturnType<ArxStorageDatabase["open"]>;
  private readonly table: ArxStorageDatabase["permissions"];

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.permissions;
  }
  async get(id: PermissionRecord["id"]): Promise<PermissionRecord | null> {
    await this.ready;
    const row = await this.table.get(id);
    return await this.parseRow({ row, deleteKey: id });
  }

  async listAll(): Promise<PermissionRecord[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const out: PermissionRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow({ row, deleteKey: row.id });
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async getByOrigin(params: { origin: string; namespace: string }): Promise<PermissionRecord | null> {
    await this.ready;
    const row = await this.table.where("[origin+namespace]").equals([params.origin, params.namespace]).first();

    if (!row) return null;
    return await this.parseRow({ row, deleteKey: row.id });
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    await this.ready;
    const rows = await this.table.where("origin").equals(origin).toArray();
    const out: PermissionRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow({ row, deleteKey: row.id });
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: PermissionRecord): Promise<void> {
    await this.ready;
    const checked = PermissionRecordSchema.parse(record);
    await this.table.put(checked);
  }

  async remove(id: PermissionRecord["id"]): Promise<void> {
    await this.ready;
    await this.table.delete(id);
  }

  async clearOrigin(origin: string): Promise<void> {
    await this.ready;
    await this.table.where("origin").equals(origin).delete();
  }

  private async parseRow(params: {
    row: PermissionRecord | undefined;
    deleteKey: PermissionRecord["id"];
  }): Promise<PermissionRecord | null> {
    const { row, deleteKey } = params;
    if (!row) return null;

    const parsed = PermissionRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid permission record, dropping", parsed.error);
      await this.table.delete(deleteKey);
      return null;
    }
    return parsed.data;
  }
}
