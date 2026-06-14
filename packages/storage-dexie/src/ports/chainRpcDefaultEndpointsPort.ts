import type { ChainRpcDefaultEndpointsPort } from "@arx/core/services";
import type { ChainRpcDefaultEndpointsRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieChainRpcDefaultEndpointsPort implements ChainRpcDefaultEndpointsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.chainRpcDefaultEndpoints;
  }

  async get(chainRef: ChainRpcDefaultEndpointsRecord["chainRef"]): Promise<ChainRpcDefaultEndpointsRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    return row ?? null;
  }

  async list(): Promise<ChainRpcDefaultEndpointsRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: ChainRpcDefaultEndpointsRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(chainRef: ChainRpcDefaultEndpointsRecord["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
