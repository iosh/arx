import type { AccountKey, AccountRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type AccountsChangedPayload =
  | { kind: "upsert"; accountKey: AccountKey }
  | { kind: "remove"; accountKey: AccountKey }
  | { kind: "removeByKeyringId"; keyringId: AccountRecord["keyringId"] }
  | { kind: "setHidden"; accountKey: AccountKey };

export type ListAccountsParams = {
  includeHidden?: boolean;
};

export type AccountsService = {
  subscribeChanged(handler: (payload: AccountsChangedPayload) => void): Unsubscribe;

  get(accountKey: AccountKey): Promise<AccountRecord | null>;
  list(params?: ListAccountsParams): Promise<AccountRecord[]>;
  upsert(record: AccountRecord): Promise<void>;
  remove(accountKey: AccountKey): Promise<void>;
  removeByKeyringId(keyringId: AccountRecord["keyringId"]): Promise<void>;
  setHidden(params: { accountKey: AccountKey; hidden: boolean }): Promise<void>;
};
