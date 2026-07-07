import type { ChainDefinitionsPort } from "@arx/core/chains";
import type { ChainDefinitionEntity } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieChainDefinitionsPort implements ChainDefinitionsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.chainDefinitions;
  }

  async get(chainRef: ChainDefinitionEntity["chainRef"]): Promise<ChainDefinitionEntity | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    return row ?? null;
  }

  async getAll(): Promise<ChainDefinitionEntity[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async put(entity: ChainDefinitionEntity): Promise<void> {
    await this.ctx.ready;
    await this.table.put(entity);
  }

  async putMany(entities: ChainDefinitionEntity[]): Promise<void> {
    await this.ctx.ready;
    await this.table.bulkPut(entities);
  }

  async delete(chainRef: ChainDefinitionEntity["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
