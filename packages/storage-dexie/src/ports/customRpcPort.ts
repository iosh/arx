import type { CustomRpcPort } from "@arx/core/services";
import type { CustomRpcRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieCustomRpcPort implements CustomRpcPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.customRpc;
  }

  async get(chainRef: CustomRpcRecord["chainRef"]): Promise<CustomRpcRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    return row ?? null;
  }

  async list(): Promise<CustomRpcRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: CustomRpcRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(chainRef: CustomRpcRecord["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
