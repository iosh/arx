import type { PermissionsPort } from "@arx/core/permissions";
import type { PermissionRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

type PermissionKey = [string, string];

export class DexiePermissionsPort implements PermissionsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.permissions;
  }

  async get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null> {
    await this.ctx.ready;

    const key: PermissionKey = [params.origin, params.namespace];
    const row = await this.table.get(key);
    return row ?? null;
  }

  async listAll(): Promise<PermissionRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async listByOrigin(origin: string): Promise<PermissionRecord[]> {
    await this.ctx.ready;
    return await this.table.where("origin").equals(origin).toArray();
  }

  async upsert(record: PermissionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    await this.ctx.ready;
    await this.table.delete([params.origin, params.namespace]);
  }

  async clearOrigin(origin: string): Promise<void> {
    await this.ctx.ready;
    await this.table.where("origin").equals(origin).delete();
  }
}
