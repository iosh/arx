import type { PermissionsPort } from "@arx/core/services";
import { type PermissionRecord, PermissionRecordSchema } from "@arx/core/storage";
import type { ArxStorageDatabase } from "../db.js";
export class DexiePermissionsPort implements PermissionsPort {
  private readonly ready: ReturnType<ArxStorageDatabase["open"]>;
  private readonly table: ArxStorageDatabase["permissions"];

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.permissions;
  }
  async get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null> {
    await this.ready;
    const key = [params.origin, params.namespace] as const;
    const row = await this.table.get(key);
    const parsed = PermissionRecordSchema.safeParse(row);
    if (!row) return null;
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid permission record, dropping", parsed.error);
      await this.table.delete(key);
      return null;
    }
    return parsed.data;
  }

  async listAll(): Promise<PermissionRecord[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const out: PermissionRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow(row);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    await this.ready;
    const rows = await this.table.where("origin").equals(origin).toArray();
    const out: PermissionRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow(row);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: PermissionRecord): Promise<void> {
    await this.ready;
    const checked = PermissionRecordSchema.parse(record);
    await this.table.put(checked);
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    await this.ready;
    await this.table.delete([params.origin, params.namespace] as const);
  }

  async clearOrigin(origin: string): Promise<void> {
    await this.ready;
    await this.table.where("origin").equals(origin).delete();
  }

  private async parseRow(row: PermissionRecord | undefined): Promise<PermissionRecord | null> {
    if (!row) return null;

    const parsed = PermissionRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid permission record, dropping", parsed.error);
      const origin = typeof (row as { origin?: unknown }).origin === "string" ? row.origin : null;
      const namespace = typeof (row as { namespace?: unknown }).namespace === "string" ? row.namespace : null;
      if (origin && namespace) {
        await this.table.delete([origin, namespace] as const);
      }
      return null;
    }
    return parsed.data;
  }
}
