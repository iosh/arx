import type { Messenger } from "../../../messenger/index.js";
import type { AccountId, AccountRecord } from "../../../storage/records.js";
import type { AccountsPort } from "./port.js";
import { ACCOUNTS_STORE_CHANGED } from "./topics.js";
import type { AccountsService, ListAccountsParams } from "./types.js";

export type CreateAccountsServiceOptions = {
  messenger: Messenger;
  port: AccountsPort;
};

const areAccountRecordsEqual = (left: AccountRecord, right: AccountRecord): boolean =>
  left.accountId === right.accountId &&
  left.namespace === right.namespace &&
  left.keyringId === right.keyringId &&
  left.derivationIndex === right.derivationIndex &&
  left.alias === right.alias &&
  Boolean(left.hidden) === Boolean(right.hidden) &&
  left.createdAt === right.createdAt;

export const createAccountsService = ({ messenger, port }: CreateAccountsServiceOptions): AccountsService => {
  const get = async (accountId: AccountId) => {
    return await port.get(accountId);
  };

  const list = async (params?: ListAccountsParams) => {
    const includeHidden = params?.includeHidden ?? false;

    const records = await port.list();
    const filtered = includeHidden ? records : records.filter((r) => !r.hidden);
    filtered.sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));

    return filtered;
  };
  const upsert = async (record: AccountRecord) => {
    const existing = await port.get(record.accountId);
    if (existing && areAccountRecordsEqual(existing, record)) {
      return;
    }

    await port.upsert(record);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "upsert", accountId: record.accountId });
  };

  const remove = async (accountId: AccountId) => {
    const existing = await port.get(accountId);
    if (!existing) {
      return;
    }

    await port.remove(accountId);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "remove", accountId });
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    const accounts = await port.list();
    if (!accounts.some((account) => account.keyringId === keyringId)) {
      return;
    }

    await port.removeByKeyringId(keyringId);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "removeByKeyringId", keyringId });
  };

  const setHidden = async (params: { accountId: AccountId; hidden: boolean }) => {
    const existing = await port.get(params.accountId);
    if (!existing) return;

    const next: AccountRecord = {
      ...existing,
      ...(params.hidden ? { hidden: true } : { hidden: undefined }),
    };

    if (areAccountRecordsEqual(existing, next)) {
      return;
    }

    await port.upsert(next);
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "setHidden", accountId: next.accountId });
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
