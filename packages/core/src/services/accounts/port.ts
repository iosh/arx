import type { AccountId, AccountRecord } from "../../db/records.js";

export interface AccountsPort {
  get(accountId: AccountId): Promise<AccountRecord | null>;
  list(): Promise<AccountRecord[]>;

  upsert(record: AccountRecord): Promise<void>;

  remove(accountId: AccountId): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
}
