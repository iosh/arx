import type { AccountsPort } from "@arx/core/services";
import type { AccountId, AccountRecord, AccountSelectionStateRecord } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { ACCOUNT_SELECTION_STATE_ID } from "../internal/ids.js";

export class DexieAccountsPort implements AccountsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.accounts;
  }

  private get selectionTable() {
    return this.ctx.db.accountSelectionState;
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

  async getSelectionState(): Promise<AccountSelectionStateRecord | null> {
    await this.ctx.ready;
    const row = await this.selectionTable.get(ACCOUNT_SELECTION_STATE_ID);
    return row ?? null;
  }

  async putSelectionState(record: AccountSelectionStateRecord): Promise<void> {
    await this.ctx.ready;
    await this.selectionTable.put(record);
  }
}
