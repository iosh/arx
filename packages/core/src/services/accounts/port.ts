import type { AccountId, AccountRecord } from "../../db/records.js";

export interface AccountsPort {
  get(accountId: AccountId): Promise<AccountRecord | null>;
  list(): Promise<AccountRecord[]>;

  upsert(record: AccountRecord): Promise<void>;
}
