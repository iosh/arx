import type { AccountsPort } from "@arx/core/services";
import type { AccountId, AccountRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";

export class DexieAccountsPort implements AccountsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.accounts;
  }

  async get(accountId: AccountId): Promise<AccountRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(accountId);
    return row ?? null;
  }

  async list(): Promise<AccountRecord[]> {
    await this.ctx.ready;
    return await this.table.toArray();
  }

  async upsert(record: AccountRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.put(record);
  }

  async remove(accountId: AccountId): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(accountId);
  }

  async removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void> {
    await this.ctx.ready;
    await this.table.where("keyringId").equals(keyringId).delete();
  }
}
