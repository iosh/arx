import type { AccountsPort } from "@arx/core/services";
import { type AccountId, type AccountRecord, AccountRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieAccountsPort implements AccountsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.accounts;
  }

  async get(accountId: AccountId): Promise<AccountRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(accountId);
    return await this.parseRow(row, accountId);
  }

  async list(): Promise<AccountRecord[]> {
    await this.ctx.ready;
    const rows = await this.table.toArray();
    const out: AccountRecord[] = [];
    for (const row of rows) {
      const deleteKey = typeof (row as { accountId?: unknown }).accountId === "string" ? row.accountId : undefined;
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

  async remove(accountId: AccountId): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(accountId);
  }

  async removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void> {
    await this.ctx.ready;
    await this.table.where("keyringId").equals(keyringId).delete();
  }

  private async parseRow(row: unknown, deleteKey?: AccountId): Promise<AccountRecord | null> {
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
