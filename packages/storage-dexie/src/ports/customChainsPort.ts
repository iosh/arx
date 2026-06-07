import type { CustomChainsPort } from "@arx/core/services";
import type { CustomChainRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieCustomChainsPort implements CustomChainsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.customChains;
  }

  async get(chainRef: CustomChainRecord["chainRef"]): Promise<CustomChainRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    return row ?? null;
  }

  async list(): Promise<CustomChainRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: CustomChainRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(chainRef: CustomChainRecord["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
