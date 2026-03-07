import type { ChainDefinitionsPort } from "@arx/core/services";
import { type ChainDefinitionEntity, ChainDefinitionEntitySchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieChainDefinitionsPort implements ChainDefinitionsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.chains;
  }

  async get(chainRef: ChainDefinitionEntity["chainRef"]): Promise<ChainDefinitionEntity | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    if (!row) return null;

    return await parseOrDrop({
      schema: ChainDefinitionEntitySchema,
      row,
      what: "chain registry entry",
      drop: () => this.table.delete(chainRef),
      log: this.ctx.log,
    });
  }

  async getAll(): Promise<ChainDefinitionEntity[]> {
    await this.ctx.ready;

    const rows = await this.table.toArray();
    const out: ChainDefinitionEntity[] = [];

    for (const row of rows) {
      if (!row) continue;

      // Best-effort delete key extraction; if missing we still validate but cannot drop safely.
      const chainRef = typeof (row as { chainRef?: unknown }).chainRef === "string" ? row.chainRef : null;
      if (!chainRef) {
        const parsed = ChainDefinitionEntitySchema.safeParse(row);
        if (!parsed.success) {
          this.ctx.log.warn("[storage-dexie] invalid chain registry entry detected, cannot drop", parsed.error);
          continue;
        }
        out.push(parsed.data as ChainDefinitionEntity);
        continue;
      }

      const parsed = await parseOrDrop({
        schema: ChainDefinitionEntitySchema,
        row,
        what: "chain registry entry",
        drop: () => this.table.delete(chainRef),
        log: this.ctx.log,
      });
      if (parsed) out.push(parsed);
    }

    return out;
  }

  async put(entity: ChainDefinitionEntity): Promise<void> {
    await this.ctx.ready;
    await this.table.put(ChainDefinitionEntitySchema.parse(entity));
  }

  async putMany(entities: ChainDefinitionEntity[]): Promise<void> {
    await this.ctx.ready;
    await this.table.bulkPut(entities.map((e) => ChainDefinitionEntitySchema.parse(e)));
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
