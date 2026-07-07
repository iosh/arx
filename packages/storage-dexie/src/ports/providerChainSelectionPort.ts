import type { ProviderChainSelectionPort } from "@arx/core/chains";
import type { ProviderChainSelectionRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieProviderChainSelectionPort implements ProviderChainSelectionPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.providerChainSelection;
  }

  async get(params: { origin: string; namespace: string }): Promise<ProviderChainSelectionRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get([params.origin, params.namespace]);
    return row ?? null;
  }

  async listAll(): Promise<ProviderChainSelectionRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: ProviderChainSelectionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(params: { origin: string; namespace: string }): Promise<void> {
    await this.ctx.ready;
    await this.table.delete([params.origin, params.namespace]);
  }
}
