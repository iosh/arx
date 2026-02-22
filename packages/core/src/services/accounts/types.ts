import type { AccountId, AccountRecord } from "../../storage/records.js";

export type AccountsChangedHandler = () => void;

export type ListAccountsParams = {
  includeHidden?: boolean;
};

export type AccountsService = {
  on(event: "changed", handler: AccountsChangedHandler): void;
  off(event: "changed", handler: AccountsChangedHandler): void;

  get(accountId: AccountId): Promise<AccountRecord | null>;
  list(params?: ListAccountsParams): Promise<AccountRecord[]>;
  upsert(record: AccountRecord): Promise<void>;
  remove(accountId: AccountId): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
  setHidden(params: { accountId: AccountId; hidden: boolean }): Promise<void>;
};
