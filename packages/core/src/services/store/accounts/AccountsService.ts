import { type AccountId, type AccountRecord, AccountRecordSchema } from "../../../storage/records.js";
import { createSignal } from "../_shared/signal.js";
import type { AccountsPort } from "./port.js";
import type { AccountsChangedPayload, AccountsService, ListAccountsParams } from "./types.js";

export type CreateAccountsServiceOptions = {
  port: AccountsPort;
};

export const createAccountsService = ({ port }: CreateAccountsServiceOptions): AccountsService => {
  const changed = createSignal<AccountsChangedPayload>();

  const get = async (accountId: AccountId) => {
    const record = await port.get(accountId);
    if (!record) return null;
    const parsed = AccountRecordSchema.safeParse(record);
    return parsed.success ? parsed.data : null;
  };

  const list = async (params?: ListAccountsParams) => {
    const includeHidden = params?.includeHidden ?? false;

    const records = await port.list();
    const parsed = records.flatMap((r) => {
      const out = AccountRecordSchema.safeParse(r);
      return out.success ? [out.data] : [];
    });

    const filtered = includeHidden ? parsed : parsed.filter((r) => !r.hidden);
    filtered.sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));

    return filtered;
  };
  const upsert = async (record: AccountRecord) => {
    const checked = AccountRecordSchema.parse(record);
    await port.upsert(checked);
    changed.emit({ kind: "upsert", accountId: checked.accountId });
  };

  const remove = async (accountId: AccountId) => {
    await port.remove(accountId);
    changed.emit({ kind: "remove", accountId });
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    await port.removeByKeyringId(keyringId);
    changed.emit({ kind: "removeByKeyringId", keyringId });
  };

  const setHidden = async (params: { accountId: AccountId; hidden: boolean }) => {
    const existing = await port.get(params.accountId);
    if (!existing) return;

    const currentParsed = AccountRecordSchema.safeParse(existing);
    if (!currentParsed.success) return;
    const current = currentParsed.data;

    const next: AccountRecord = AccountRecordSchema.parse({
      ...current,
      ...(params.hidden ? { hidden: true } : { hidden: undefined }),
    });

    await port.upsert(next);
    changed.emit({ kind: "setHidden", accountId: next.accountId });
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
