import type { CustomRpcPort } from "@arx/core/services";
import { type CustomRpcRecord, CustomRpcRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieCustomRpcPort implements CustomRpcPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.customRpc;
  }

  async get(chainRef: CustomRpcRecord["chainRef"]): Promise<CustomRpcRecord | null> {
    await this.ctx.ready;

    const row = await this.table.get(chainRef);
    if (!row) return null;

    return await parseOrDrop({
      schema: CustomRpcRecordSchema,
      row,
      what: "custom rpc override",
      drop: () => this.table.delete(chainRef),
      log: this.ctx.log,
    });
  }

  async list(): Promise<CustomRpcRecord[]> {
    await this.ctx.ready;

    const rows = await this.table.toArray();
    const out: CustomRpcRecord[] = [];

    for (const row of rows) {
      if (!row) continue;

      const chainRef = typeof (row as { chainRef?: unknown }).chainRef === "string" ? row.chainRef : null;
      if (!chainRef) {
        const parsed = CustomRpcRecordSchema.safeParse(row);
        if (!parsed.success) {
          this.ctx.log.warn("[storage-dexie] invalid custom rpc override detected, cannot drop", parsed.error);
          continue;
        }
        out.push(parsed.data as CustomRpcRecord);
        continue;
      }

      const parsed = await parseOrDrop({
        schema: CustomRpcRecordSchema,
        row,
        what: "custom rpc override",
        drop: () => this.table.delete(chainRef),
        log: this.ctx.log,
      });
      if (parsed) {
        out.push(parsed);
      }
    }

    return out;
  }

  async upsert(record: CustomRpcRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(CustomRpcRecordSchema.parse(record));
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
