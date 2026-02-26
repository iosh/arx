import type { AccountId, AccountRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type AccountsChangedPayload =
  | { kind: "upsert"; accountId: AccountId }
  | { kind: "remove"; accountId: AccountId }
  | { kind: "removeByKeyringId"; keyringId: AccountRecord["keyringId"] }
  | { kind: "setHidden"; accountId: AccountId };

export type ListAccountsParams = {
  includeHidden?: boolean;
};

export type AccountsService = {
  subscribeChanged(handler: (payload: AccountsChangedPayload) => void): Unsubscribe;

  get(accountId: AccountId): Promise<AccountRecord | null>;
  list(params?: ListAccountsParams): Promise<AccountRecord[]>;
  upsert(record: AccountRecord): Promise<void>;
  remove(accountId: AccountId): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
  setHidden(params: { accountId: AccountId; hidden: boolean }): Promise<void>;
};
