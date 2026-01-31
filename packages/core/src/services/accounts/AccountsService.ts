import { EventEmitter } from "eventemitter3";
import { type AccountId, type AccountRecord, AccountRecordSchema } from "../../db/records.js";
import type { AccountsPort } from "./port.js";
import type { AccountsService, ListAccountsParams } from "./types.js";

type ChangedEvent = "changed";

export type CreateAccountsServiceOptions = {
  port: AccountsPort;
};

export const createAccountsService = ({ port }: CreateAccountsServiceOptions): AccountsService => {
  const emitter = new EventEmitter<ChangedEvent>();

  const emitChanged = () => {
    emitter.emit("changed");
  };

  const get = async (accountId: AccountId) => {
    const record = await port.get(accountId);
    return record ? AccountRecordSchema.parse(record) : null;
  };

  const list = async (params?: ListAccountsParams) => {
    const includeHidden = params?.includeHidden ?? false;

    const records = await port.list();
    const parsed = records.map((r) => AccountRecordSchema.parse(r));

    const filtered = includeHidden ? parsed : parsed.filter((r) => !r.hidden);
    filtered.sort((a, b) => a.createdAt - b.createdAt);

    return filtered;
  };
  const upsert = async (record: AccountRecord) => {
    const checked = AccountRecordSchema.parse(record);
    await port.upsert(checked);
    emitChanged();
  };

  const remove = async (accountId: AccountId) => {
    await port.remove(accountId);
    emitChanged();
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    await port.removeByKeyringId(keyringId);
    emitChanged();
  };

  const setHidden = async (params: { accountId: AccountId; hidden: boolean }) => {
    const existing = await port.get(params.accountId);
    if (!existing) return;

    const current = AccountRecordSchema.parse(existing);

    const next: AccountRecord = AccountRecordSchema.parse({
      ...current,
      ...(params.hidden ? { hidden: true } : { hidden: undefined }),
    });

    await port.upsert(next);
    emitChanged();
  };
  return {
    on(event, handler) {
      if (event !== "changed") return;
      emitter.on("changed", handler);
    },
    off(event, handler) {
      if (event !== "changed") return;
      emitter.off("changed", handler);
    },

    get,
    list,
    upsert,
    remove,
    removeByKeyringId,
    setHidden,
  };
};
