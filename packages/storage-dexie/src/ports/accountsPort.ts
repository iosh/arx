import type { AccountsPort } from "@arx/core/services";
import { type AccountKey, type AccountRecord, AccountRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieAccountsPort implements AccountsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.accounts;
  }

  async get(accountKey: AccountKey): Promise<AccountRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(accountKey);
    return await this.parseRow(row, accountKey);
  }

  async list(): Promise<AccountRecord[]> {
    await this.ctx.ready;
    const rows = await this.table.toArray();
    const out: AccountRecord[] = [];
    for (const row of rows) {
      const deleteKey = typeof (row as { accountKey?: unknown }).accountKey === "string" ? row.accountKey : undefined;
      const parsed = await this.parseRow(row, deleteKey);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: AccountRecord): Promise<void> {
    await this.ctx.ready;
    const checked = AccountRecordSchema.parse(record);
    await this.table.put(checked);
  }

  async remove(accountKey: AccountKey): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(accountKey);
  }

  async removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void> {
    await this.ctx.ready;
    await this.table.where("keyringId").equals(keyringId).delete();
  }

  private async parseRow(row: unknown, deleteKey?: AccountKey): Promise<AccountRecord | null> {
    if (!row) return null;

    if (!deleteKey) {
      const parsed = AccountRecordSchema.safeParse(row);
      if (!parsed.success) {
        this.ctx.log.warn("[storage-dexie] invalid account record detected, cannot drop", parsed.error);
        return null;
      }
      return parsed.data;
    }

    return await parseOrDrop({
      schema: AccountRecordSchema,
      row,
      what: "account record",
      drop: () => this.table.delete(deleteKey),
      log: this.ctx.log,
    });
  }
}
