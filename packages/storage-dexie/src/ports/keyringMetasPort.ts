import type { KeyringMetasPort } from "@arx/core/services";
import { type KeyringMetaRecord, KeyringMetaRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";
export class DexieKeyringMetasPort implements KeyringMetasPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.keyringMetas;
  }

  async get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(id);
    return await this.parseRow(row, id);
  }

  async list(): Promise<KeyringMetaRecord[]> {
    await this.ctx.ready;
    const rows = await this.table.toArray();
    const out: KeyringMetaRecord[] = [];
    for (const row of rows) {
      const deleteKey = typeof (row as { id?: unknown }).id === "string" ? row.id : undefined;
      const parsed = await this.parseRow(row, deleteKey);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: KeyringMetaRecord): Promise<void> {
    await this.ctx.ready;
    const checked = KeyringMetaRecordSchema.parse(record);
    await this.table.put(checked);
  }
  async remove(id: KeyringMetaRecord["id"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(id);
  }
  private async parseRow(row: unknown, deleteKey?: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null> {
    if (!row) return null;

    if (!deleteKey) {
      const parsed = KeyringMetaRecordSchema.safeParse(row);
      if (!parsed.success) {
        this.ctx.log.warn("[storage-dexie] invalid keyring meta record detected, cannot drop", parsed.error);
        return null;
      }
      return parsed.data;
    }

    return await parseOrDrop({
      schema: KeyringMetaRecordSchema,
      row,
      what: "keyring meta record",
      drop: () => this.table.delete(deleteKey),
      log: this.ctx.log,
    });
  }
}
