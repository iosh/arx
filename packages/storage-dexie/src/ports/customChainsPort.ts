import type { CustomChainsPort } from "@arx/core/services";
import { type CustomChainRecord, CustomChainRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieCustomChainsPort implements CustomChainsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.customChains;
  }

  async get(chainRef: CustomChainRecord["chainRef"]): Promise<CustomChainRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    if (!row) return null;

    return await parseOrDrop({
      schema: CustomChainRecordSchema,
      row,
      what: "custom chain",
      drop: () => this.table.delete(chainRef),
      log: this.ctx.log,
    });
  }

  async list(): Promise<CustomChainRecord[]> {
    await this.ctx.ready;

    const rows = await this.table.toArray();
    const out: CustomChainRecord[] = [];

    for (const row of rows) {
      if (!row) continue;

      const chainRef = typeof (row as { chainRef?: unknown }).chainRef === "string" ? row.chainRef : null;
      if (!chainRef) {
        const parsed = CustomChainRecordSchema.safeParse(row);
        if (!parsed.success) {
          this.ctx.log.warn("[storage-dexie] invalid custom chain detected, cannot drop", parsed.error);
          continue;
        }
        out.push(parsed.data as CustomChainRecord);
        continue;
      }

      const parsed = await parseOrDrop({
        schema: CustomChainRecordSchema,
        row,
        what: "custom chain",
        drop: () => this.table.delete(chainRef),
        log: this.ctx.log,
      });
      if (parsed) {
        out.push(parsed);
      }
    }

    return out;
  }

  async upsert(record: CustomChainRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(CustomChainRecordSchema.parse(record));
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
