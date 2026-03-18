import type { AccountKey, AccountRecord } from "../../../storage/records.js";

export interface AccountsPort {
  get(accountKey: AccountKey): Promise<AccountRecord | null>;
  list(): Promise<AccountRecord[]>;

  upsert(record: AccountRecord): Promise<void>;

  remove(accountKey: AccountKey): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
}
