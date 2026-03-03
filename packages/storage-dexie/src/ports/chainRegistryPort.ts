import type { ChainRegistryPort } from "@arx/core/chains";
import { type ChainRegistryEntity, ChainRegistryEntitySchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieChainRegistryPort implements ChainRegistryPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.chains;
  }

  async get(chainRef: ChainRegistryEntity["chainRef"]): Promise<ChainRegistryEntity | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    if (!row) return null;

    return await parseOrDrop({
      schema: ChainRegistryEntitySchema,
      row,
      what: "chain registry entry",
      drop: () => this.table.delete(chainRef),
      log: this.ctx.log,
    });
  }

  async getAll(): Promise<ChainRegistryEntity[]> {
    await this.ctx.ready;

    const rows = await this.table.toArray();
    const out: ChainRegistryEntity[] = [];

    for (const row of rows) {
      if (!row) continue;

      // Best-effort delete key extraction; if missing we still validate but cannot drop safely.
      const chainRef = typeof (row as { chainRef?: unknown }).chainRef === "string" ? row.chainRef : null;
      if (!chainRef) {
        const parsed = ChainRegistryEntitySchema.safeParse(row);
        if (!parsed.success) {
          this.ctx.log.warn("[storage-dexie] invalid chain registry entry detected, cannot drop", parsed.error);
          continue;
        }
        out.push(parsed.data as ChainRegistryEntity);
        continue;
      }

      const parsed = await parseOrDrop({
        schema: ChainRegistryEntitySchema,
        row,
        what: "chain registry entry",
        drop: () => this.table.delete(chainRef),
        log: this.ctx.log,
      });
      if (parsed) out.push(parsed);
    }

    return out;
  }

  async put(entity: ChainRegistryEntity): Promise<void> {
    await this.ctx.ready;
    await this.table.put(ChainRegistryEntitySchema.parse(entity));
  }

  async putMany(entities: ChainRegistryEntity[]): Promise<void> {
    await this.ctx.ready;
    await this.table.bulkPut(entities.map((e) => ChainRegistryEntitySchema.parse(e)));
  }

  async delete(chainRef: ChainRegistryEntity["chainRef"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ctx.ready;
    await this.table.clear();
  }
}
