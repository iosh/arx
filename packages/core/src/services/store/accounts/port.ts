import type { AccountId, AccountRecord, AccountSelectionStateRecord } from "../../../storage/records.js";

export interface AccountsPort {
  get(accountId: AccountId): Promise<AccountRecord | null>;
  list(): Promise<AccountRecord[]>;

  upsert(record: AccountRecord): Promise<void>;

  remove(accountId: AccountId): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;

  getSelectionState(): Promise<AccountSelectionStateRecord | null>;
  putSelectionState(record: AccountSelectionStateRecord): Promise<void>;
}
