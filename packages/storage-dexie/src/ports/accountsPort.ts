import { type AccountId, type AccountRecord, AccountRecordSchema } from "@arx/core/db";
import type { AccountsPort } from "@arx/core/services";
import type { ArxStorageDatabase } from "../db.js";

export class DexieAccountsPort implements AccountsPort {
  private readonly ready: ReturnType<ArxStorageDatabase["open"]>;
  private readonly table: ArxStorageDatabase["accounts"];

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.accounts;
  }
  async get(accountId: AccountId): Promise<AccountRecord | null> {
    await this.ready;
    const row = await this.table.get(accountId);
    return await this.parseRow({ row, deleteKey: accountId });
  }

  async list(): Promise<AccountRecord[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const out: AccountRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow({ row, deleteKey: row.accountId });
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async upsert(record: AccountRecord): Promise<void> {
    await this.ready;
    const checked = AccountRecordSchema.parse(record);
    await this.table.put(checked);
  }

  private async parseRow(params: {
    row: AccountRecord | undefined;
    deleteKey: AccountId;
  }): Promise<AccountRecord | null> {
    const { row, deleteKey } = params;
    if (!row) return null;

    const parsed = AccountRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid account record, dropping", parsed.error);
      await this.table.delete(deleteKey);
      return null;
    }
    return parsed.data;
  }
}
