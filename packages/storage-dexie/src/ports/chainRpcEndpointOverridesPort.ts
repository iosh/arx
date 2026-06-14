import type { ChainRpcEndpointOverridesPort } from "@arx/core/services";
import type { ChainRpcEndpointOverrideRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieChainRpcEndpointOverridesPort implements ChainRpcEndpointOverridesPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.chainRpcEndpointOverrides;
  }

  async get(chainRef: ChainRpcEndpointOverrideRecord["chainRef"]): Promise<ChainRpcEndpointOverrideRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    return row ?? null;
  }

  async list(): Promise<ChainRpcEndpointOverrideRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: ChainRpcEndpointOverrideRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(chainRef: ChainRpcEndpointOverrideRecord["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
