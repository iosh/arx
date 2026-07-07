import { getAccountIdNamespace } from "./addressing/accountId.js";
import { AccountNamespaceMismatchError } from "./errors.js";
import { OWNER_CHANGED } from "../events/ownerChanged.js";
import { KeyringAccountNotFoundError } from "../keyring/errors.js";
import type { Messenger } from "../messenger/index.js";
import { PermissionDeniedError } from "../permissions/errors.js";
import type { AccountId, AccountRecord } from "../storage/records.js";
import { createSerialQueue } from "../utils/serialQueue.js";
import type { AccountsPort } from "./accountsPort.js";
import { ACCOUNTS_STORE_CHANGED } from "./accountsTopics.js";
import type { AccountsService, ListAccountsParams } from "./accountsTypes.js";

export type CreateAccountsServiceOptions = {
  messenger: Messenger;
  port: AccountsPort;
};

const areAccountRecordsEqual = (left: AccountRecord, right: AccountRecord): boolean =>
  left.accountId === right.accountId &&
  left.keyringId === right.keyringId &&
  left.derivationIndex === right.derivationIndex &&
  left.alias === right.alias &&
  Boolean(left.hidden) === Boolean(right.hidden) &&
  left.createdAt === right.createdAt;

const areAccountSelectionsEqual = (left: Record<string, AccountId>, right: Record<string, AccountId>): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
};

const cloneSelection = (selectedAccountIdsByNamespace: Record<string, AccountId>): Record<string, AccountId> => ({
  ...selectedAccountIdsByNamespace,
});

export const createAccountsService = ({ messenger, port }: CreateAccountsServiceOptions): AccountsService => {
  const runSelectionWrite = createSerialQueue();

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
    messenger.publish(OWNER_CHANGED, { topic: "identity", change: "account", accountId: record.accountId });
  };

  const readSelection = async (): Promise<Record<string, AccountId>> => {
    const record = await port.getSelectionState();
    return cloneSelection(record?.selectedAccountIdsByNamespace ?? {});
  };

  const writeSelection = async (
    currentSelectedAccountIdsByNamespace: Record<string, AccountId>,
    nextSelectedAccountIdsByNamespace: Record<string, AccountId>,
    changedNamespace: string | null,
  ): Promise<void> => {
    if (areAccountSelectionsEqual(currentSelectedAccountIdsByNamespace, nextSelectedAccountIdsByNamespace)) {
      return;
    }

    await port.putSelectionState({
      id: "account-selection",
      selectedAccountIdsByNamespace: cloneSelection(nextSelectedAccountIdsByNamespace),
    });

    if (changedNamespace) {
      messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "setSelectedAccount", namespace: changedNamespace });
      messenger.publish(OWNER_CHANGED, { topic: "identity", change: "selection", namespace: changedNamespace });
    }
  };

  const clearSelectedAccountIds = async (accountIds: Set<AccountId>): Promise<void> => {
    if (accountIds.size === 0) return;

    await runSelectionWrite(async () => {
      const current = await readSelection();
      const next = cloneSelection(current);
      for (const [namespace, selectedAccountId] of Object.entries(next)) {
        if (accountIds.has(selectedAccountId)) {
          delete next[namespace];
        }
      }

      await writeSelection(current, next, null);
    });
  };

  const remove = async (accountId: AccountId) => {
    const existing = await port.get(accountId);
    if (!existing) {
      return;
    }

    await port.remove(accountId);
    await clearSelectedAccountIds(new Set([accountId]));
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "remove", accountId });
    messenger.publish(OWNER_CHANGED, { topic: "identity", change: "account", accountId });
  };

  const removeByKeyringId = async (keyringId: AccountRecord["keyringId"]) => {
    const accounts = await port.list();
    const removedAccountIds = accounts
      .filter((account) => account.keyringId === keyringId)
      .map((account) => account.accountId);
    if (removedAccountIds.length === 0) {
      return;
    }

    await port.removeByKeyringId(keyringId);
    await clearSelectedAccountIds(new Set(removedAccountIds));
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "removeByKeyringId", keyringId });
    messenger.publish(OWNER_CHANGED, { topic: "identity", change: "keyring", keyringId });
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
    if (params.hidden) {
      await clearSelectedAccountIds(new Set([next.accountId]));
    }
    messenger.publish(ACCOUNTS_STORE_CHANGED, { kind: "setHidden", accountId: next.accountId });
    messenger.publish(OWNER_CHANGED, { topic: "identity", change: "account", accountId: next.accountId });
  };

  const getSelectedAccountIdsByNamespace = async () => {
    return await readSelection();
  };

  const getSelectedAccountId = async (namespace: string) => {
    const namespaceKey = namespace.trim();
    if (!namespaceKey) return null;

    const selectedAccountIdsByNamespace = await readSelection();
    return selectedAccountIdsByNamespace[namespaceKey] ?? null;
  };

  const setSelectedAccountId = async (params: { namespace: string; accountId: AccountId | null }) => {
    const namespace = params.namespace.trim();
    if (!namespace) return;

    if (params.accountId !== null) {
      const accountNamespace = getAccountIdNamespace(params.accountId);
      if (accountNamespace !== namespace) {
        throw new AccountNamespaceMismatchError({ namespace, accountNamespace });
      }

      const record = await port.get(params.accountId);
      if (!record) {
        throw new KeyringAccountNotFoundError();
      }
      if (record.hidden) {
        throw new PermissionDeniedError();
      }
    }

    await runSelectionWrite(async () => {
      const current = await readSelection();
      const next = cloneSelection(current);
      if (params.accountId === null) {
        delete next[namespace];
      } else {
        next[namespace] = params.accountId;
      }

      await writeSelection(current, next, namespace);
    });
  };

  return {
    subscribeChanged: (handler) => messenger.subscribe(ACCOUNTS_STORE_CHANGED, handler),

    get,
    list,
    upsert,
    remove,
    removeByKeyringId,
    setHidden,
    getSelectedAccountIdsByNamespace,
    getSelectedAccountId,
    setSelectedAccountId,
  };
};
