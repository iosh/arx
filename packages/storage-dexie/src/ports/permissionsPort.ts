import type { PermissionsPort } from "@arx/core/services";
import { type PermissionRecord, PermissionRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

type PermissionKey = [string, string];

const toPermissionKey = (row: unknown): PermissionKey | null => {
  const candidate = row as { origin?: unknown; namespace?: unknown };
  const origin = typeof candidate.origin === "string" ? candidate.origin : null;
  const namespace = typeof candidate.namespace === "string" ? candidate.namespace : null;
  if (!origin || !namespace) return null;
  return [origin, namespace];
};

export class DexiePermissionsPort implements PermissionsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.permissions;
  }

  async get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null> {
    await this.ctx.ready;

    const key: PermissionKey = [params.origin, params.namespace];
    const row = await this.table.get(key);
    return await this.parseRow(row, key);
  }

  async listAll(): Promise<PermissionRecord[]> {
    await this.ctx.ready;

    const rows = await this.table.toArray();
    const out: PermissionRecord[] = [];

    for (const row of rows) {
      const key = toPermissionKey(row);
      const parsed = await this.parseRow(row, key ?? undefined);
      if (parsed) out.push(parsed);
    }

    return out;
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    await this.ctx.ready;

    const rows = await this.table.where("origin").equals(origin).toArray();
    const out: PermissionRecord[] = [];

    for (const row of rows) {
      const key = toPermissionKey(row);
      const parsed = await this.parseRow(row, key ?? undefined);
      if (parsed) out.push(parsed);
    }

    return out;
  }

  async upsert(record: PermissionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(PermissionRecordSchema.parse(record));
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    await this.ctx.ready;
    await this.table.delete([params.origin, params.namespace]);
  }

  async clearOrigin(origin: string): Promise<void> {
    await this.ctx.ready;
    await this.table.where("origin").equals(origin).delete();
  }

  private async parseRow(row: unknown, deleteKey?: PermissionKey): Promise<PermissionRecord | null> {
    if (!row) return null;

    if (!deleteKey) {
      const parsed = PermissionRecordSchema.safeParse(row);
      if (!parsed.success) {
        this.ctx.log.warn("[storage-dexie] invalid permission record detected, cannot drop", parsed.error);
        return null;
      }
      return parsed.data;
    }

    return await parseOrDrop({
      schema: PermissionRecordSchema,
      row,
      what: "permission record",
      drop: () => this.table.delete(deleteKey),
      log: this.ctx.log,
    });
  }
}
