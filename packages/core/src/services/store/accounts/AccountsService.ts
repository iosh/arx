import type { Messenger } from "../../../messenger/index.js";
import type { AccountKey, AccountRecord } from "../../../storage/records.js";
import type { AccountsPort } from "./port.js";
import { ACCOUNTS_STORE_CHANGED } from "./topics.js";
import type { AccountsService, ListAccountsParams } from "./types.js";

export type CreateAccountsServiceOptions = {
  messenger: Messenger;
  port: AccountsPort;
};

const areAccountRecordsEqual = (left: AccountRecord, right: AccountRecord): boolean =>
  left.accountKey === right.accountKey &&
  left.namespace === right.namespace &&
  left.keyringId === right.keyringId &&
  left.derivationIndex === right.derivationIndex &&
  left.alias === right.alias &&
  Boolean(left.hidden) === Boolean(right.hidden) &&
  left.createdAt === right.createdAt;

export const createAccountsService = ({ messenger, port }: CreateAccountsServiceOptions): AccountsService => {
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
    const existing = await port.get(record.accountKey);
    if (existing && areAccountRecordsEqual(existing, record)) {
      return;
    }

    await port.upsert(record);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "upsert", accountKey: record.accountKey });
  };

  const remove = async (accountKey: AccountKey) => {
    const existing = await port.get(accountKey);
    if (!existing) {
      return;
    }

    await port.remove(accountKey);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "remove", accountKey });
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    const accounts = await port.list();
    if (!accounts.some((account) => account.keyringId === keyringId)) {
      return;
    }

    await port.removeByKeyringId(keyringId);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "removeByKeyringId", keyringId });
  };

  const setHidden = async (params: { accountKey: AccountKey; hidden: boolean }) => {
    const existing = await port.get(params.accountKey);
    if (!existing) return;

    const next: AccountRecord = {
      ...existing,
      ...(params.hidden ? { hidden: true } : { hidden: undefined }),
    };

    if (areAccountRecordsEqual(existing, next)) {
      return;
    }

    await port.upsert(next);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "setHidden", accountKey: next.accountKey });
  };
  return {
    subscribeChanged: (handler) => messenger.subscribe(ACCOUNTS_STORE_CHANGED, handler),

    get,
    list,
    upsert,
    remove,
    removeByKeyringId,
    setHidden,
  };
};
