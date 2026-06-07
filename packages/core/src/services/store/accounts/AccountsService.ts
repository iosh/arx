import type { AccountKey, AccountRecord } from "../../../storage/records.js";
import { createSignal } from "../_shared/signal.js";
import type { AccountsPort } from "./port.js";
import type { AccountsChangedPayload, AccountsService, ListAccountsParams } from "./types.js";

export type CreateAccountsServiceOptions = {
  port: AccountsPort;
};

export const createAccountsService = ({ port }: CreateAccountsServiceOptions): AccountsService => {
  const changed = createSignal<AccountsChangedPayload>();

  const get = async (accountKey: AccountKey) => {
    return await port.get(accountKey);
  };

  const list = async (params?: ListAccountsParams) => {
    const includeHidden = params?.includeHidden ?? false;

    const records = await port.list();
    const filtered = includeHidden ? records : records.filter((r) => !r.hidden);
    filtered.sort((a, b) => a.createdAt - b.createdAt || a.accountKey.localeCompare(b.accountKey));

    return filtered;
  };
  const upsert = async (record: AccountRecord) => {
    await port.upsert(record);
    changed.emit({ kind: "upsert", accountKey: record.accountKey });
  };

  const remove = async (accountKey: AccountKey) => {
    await port.remove(accountKey);
    changed.emit({ kind: "remove", accountKey });
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    await port.removeByKeyringId(keyringId);
    changed.emit({ kind: "removeByKeyringId", keyringId });
  };

  const setHidden = async (params: { accountKey: AccountKey; hidden: boolean }) => {
    const existing = await port.get(params.accountKey);
    if (!existing) return;

    const next: AccountRecord = {
      ...existing,
      ...(params.hidden ? { hidden: true } : { hidden: undefined }),
    };

    await port.upsert(next);
    changed.emit({ kind: "setHidden", accountKey: next.accountKey });
  };
  return {
    subscribeChanged: changed.subscribe,

    get,
    list,
    upsert,
    remove,
    removeByKeyringId,
    setHidden,
  };
};
