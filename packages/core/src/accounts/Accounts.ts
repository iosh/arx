import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import { parseChainRef } from "../networks/chainRef.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { uniqueSortedStrings } from "../utils/array.js";
import { type AccountId, getAccountIdNamespace } from "./accountId.js";
import { findAccountHideReplacement } from "./accountVisibility.js";
import type { AccountsBootstrap } from "./bootstrap.js";
import {
  AccountAlreadyExistsError,
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
  AccountRemovalSelectionUnavailableError,
  AccountSelectionMissingError,
  LastVisibleAccountHiddenError,
  PrivateKeyAccountHiddenUnsupportedError,
} from "./errors.js";
import { type AccountsNamespaceAdapters, getAccountsNamespaceAdapter } from "./namespaceAdapter.js";
import {
  type AccountRecord,
  type AccountSelectionRecord,
  accountSelectionWrites,
  accountWrites,
  type HdAccountOrigin,
} from "./persistence.js";
import type { Account, AccountAddress, AccountsChanged, Address } from "./types.js";

export type AccountsUpdate = Readonly<{
  nextRecords: ReadonlyMap<AccountId, AccountRecord>;
  nextSelections: ReadonlyMap<Namespace, AccountId>;
  persistenceChanges: readonly PersistenceChange[];
  changedAccountIds: readonly AccountId[];
  changedNamespaces: readonly Namespace[];
}>;

export type AccountUpdate = AccountsUpdate & Readonly<{ account: Account }>;

export type AccountHiddenUpdate = AccountUpdate & Readonly<{ replacementAccount: Account | null }>;

export type AccountsRemovalUpdate = AccountsUpdate &
  Readonly<{
    removedAccountIds: readonly AccountId[];
  }>;

const EMPTY_BOOTSTRAP: AccountsBootstrap = { records: [], selections: [] };

const sortRecords = (records: readonly AccountRecord[]): AccountRecord[] =>
  [...records].sort((left, right) => left.createdAt - right.createdAt || left.accountId.localeCompare(right.accountId));

const accountSelectionRecord = (namespace: Namespace, accountId: AccountId): AccountSelectionRecord => ({
  namespace,
  accountId,
});

type AccountsOptions = Readonly<{
  adapters: AccountsNamespaceAdapters;
  bootstrap?: AccountsBootstrap;
  mutations: CoreMutationQueue;
  publishChanged(change: AccountsChanged): void;
}>;

/** Owns account records, namespace selection, address projections, and standalone account mutations. */
export class Accounts {
  readonly #adapters: AccountsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: AccountsOptions["publishChanged"];
  #records: ReadonlyMap<AccountId, AccountRecord>;
  #selections: ReadonlyMap<Namespace, AccountId>;

  constructor(options: AccountsOptions) {
    const bootstrap = options.bootstrap ?? EMPTY_BOOTSTRAP;

    this.#adapters = options.adapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#records = new Map(bootstrap.records.map((record) => [record.accountId, record]));
    this.#selections = new Map(bootstrap.selections.map((selection) => [selection.namespace, selection.accountId]));
  }

  getAccountRecord(accountId: AccountId): AccountRecord | null {
    return this.#records.get(accountId) ?? null;
  }

  listAccountRecords(): readonly AccountRecord[] {
    return sortRecords([...this.#records.values()]);
  }

  listHdAccountRecords(hdKeyringIds: readonly HdKeyringId[]): readonly AccountRecord[] {
    const selected = new Set(hdKeyringIds);
    return this.listAccountRecords().filter(
      (record) => record.origin.type === "hd" && selected.has(record.origin.hdKeyringId),
    );
  }

  listPrivateKeyAccountRecords(keySourceIds: readonly KeySourceId[]): readonly AccountRecord[] {
    const selected = new Set(keySourceIds);
    return this.listAccountRecords().filter(
      (record) => record.origin.type === "private-key" && selected.has(record.origin.keySourceId),
    );
  }

  listAccountIds(): readonly AccountId[] {
    return this.listAccountRecords().map((record) => record.accountId);
  }

  getAccount(accountId: AccountId): Account | null {
    const record = this.#records.get(accountId);
    return record ? this.toAccount(record) : null;
  }

  listAccounts(): readonly Account[] {
    return this.listAccountRecords().map((record) => this.toAccount(record));
  }

  listSelectableAccounts(namespace: Namespace): readonly Account[] {
    getAccountsNamespaceAdapter(this.#adapters, namespace);
    return this.listAccounts().filter((account) => account.namespace === namespace && !account.hidden);
  }

  getSelectedAccountId(namespace: Namespace): AccountId | null {
    getAccountsNamespaceAdapter(this.#adapters, namespace);
    return this.#selections.get(namespace) ?? null;
  }

  getSelectedAccount(namespace: Namespace): Account {
    const accountId = this.getSelectedAccountId(namespace);
    if (!accountId) throw new AccountSelectionMissingError(namespace);
    return this.toAccount(this.requireAccountRecord(accountId));
  }

  accountIdFromAddress(input: { chainRef: ChainRef; address: string }): AccountId {
    const { namespace } = parseChainRef(input.chainRef);
    return getAccountsNamespaceAdapter(this.#adapters, namespace).accountIdFromAddress(input);
  }

  getAddress(input: { chainRef: ChainRef; accountId: AccountId }): AccountAddress {
    const { namespace: chainNamespace } = parseChainRef(input.chainRef);
    const accountNamespace = getAccountIdNamespace(input.accountId);
    if (accountNamespace !== chainNamespace) {
      throw new AccountNamespaceMismatchError({
        accountId: input.accountId,
        accountNamespace,
        expectedNamespace: chainNamespace,
      });
    }

    const address = getAccountsNamespaceAdapter(this.#adapters, accountNamespace).addressForAccountId(input);
    return { accountId: input.accountId, chainRef: input.chainRef, ...address };
  }

  getAddresses(input: { accountId: AccountId; chainRef: ChainRef }): readonly Address[] {
    const { displayAddress } = this.getAddress(input);
    return [{ address: displayAddress, namespace: getAccountIdNamespace(input.accountId), chainRef: input.chainRef }];
  }

  listAddresses(chainRef: ChainRef): readonly AccountAddress[] {
    const { namespace } = parseChainRef(chainRef);
    getAccountsNamespaceAdapter(this.#adapters, namespace);

    return this.listAccountRecords()
      .filter((record) => getAccountIdNamespace(record.accountId) === namespace)
      .map((record) => this.getAddress({ chainRef, accountId: record.accountId }));
  }

  listSelectableAddresses(chainRef: ChainRef): readonly AccountAddress[] {
    const { namespace } = parseChainRef(chainRef);
    return this.listSelectableAccounts(namespace).map((account) =>
      this.getAddress({ chainRef, accountId: account.accountId }),
    );
  }

  getSelectedAddress(chainRef: ChainRef): AccountAddress {
    const { namespace } = parseChainRef(chainRef);
    getAccountsNamespaceAdapter(this.#adapters, namespace);

    const accountId = this.#selections.get(namespace);
    if (!accountId) throw new AccountSelectionMissingError(namespace);

    return this.getAddress({ chainRef, accountId });
  }

  rename(input: { accountId: AccountId; alias?: string }): Promise<void> {
    return this.commitUpdate(() => this.prepareRenameAccount(input.accountId, input.alias));
  }

  select(accountId: AccountId): Promise<void> {
    return this.commitUpdate(() => this.prepareSelectAccount(accountId));
  }

  prepareAddAccount(
    account: Omit<AccountRecord, "hidden">,
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): AccountUpdate {
    const namespace = getAccountIdNamespace(account.accountId);
    getAccountsNamespaceAdapter(this.#adapters, namespace);
    if (this.#records.has(account.accountId)) throw new AccountAlreadyExistsError(account.accountId);

    const shouldSelectAccount = selectAsCurrent || !this.#selections.has(namespace);
    return this.prepareAccountUpdate(
      { ...account, hidden: false },
      shouldSelectAccount ? account.accountId : undefined,
    );
  }

  prepareRenameAccount(accountId: AccountId, alias: string | undefined): AccountsUpdate | null {
    const current = this.requireAccountRecord(accountId);
    if (current.alias === alias) return null;

    const { alias: _currentAlias, ...recordWithoutAlias } = current;
    const renamed = alias === undefined ? recordWithoutAlias : { ...recordWithoutAlias, alias };
    const nextRecords = new Map(this.#records);
    nextRecords.set(accountId, renamed);

    return this.update(
      nextRecords,
      this.#selections,
      [accountWrites.put(renamed)],
      [accountId],
      [getAccountIdNamespace(accountId)],
    );
  }

  /** The wallet command must check that both sources control the same account. */
  prepareAssignHdOrigin(
    accountId: AccountId,
    origin: HdAccountOrigin,
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): AccountUpdate {
    const current = this.requireAccountRecord(accountId);
    return this.prepareAccountUpdate({ ...current, origin }, selectAsCurrent ? accountId : undefined);
  }

  private prepareAccountUpdate(record: AccountRecord, selectedAccountId?: AccountId): AccountUpdate {
    const accountId = record.accountId;
    const namespace = getAccountIdNamespace(accountId);
    const nextRecords = new Map(this.#records);
    nextRecords.set(accountId, record);

    const nextSelections = new Map(this.#selections);
    const persistenceChanges: PersistenceChange[] = [accountWrites.put(record)];
    const changedAccountIds = [accountId];
    const previousAccountId = this.#selections.get(namespace);
    if (selectedAccountId !== undefined && previousAccountId !== selectedAccountId) {
      nextSelections.set(namespace, selectedAccountId);
      persistenceChanges.push(accountSelectionWrites.put(accountSelectionRecord(namespace, selectedAccountId)));
      changedAccountIds.push(selectedAccountId);
      if (previousAccountId) changedAccountIds.push(previousAccountId);
    }

    return {
      ...this.update(nextRecords, nextSelections, persistenceChanges, changedAccountIds, [namespace]),
      account: this.toAccount(record, nextSelections),
    };
  }

  prepareSelectAccount(accountId: AccountId): AccountsUpdate | null {
    const account = this.requireAccountRecord(accountId);
    if (account.hidden) throw new AccountHiddenSelectionError(accountId);

    const namespace = getAccountIdNamespace(accountId);
    const previousAccountId = this.#selections.get(namespace);
    if (previousAccountId === accountId) return null;

    const nextSelections = new Map(this.#selections);
    nextSelections.set(namespace, accountId);

    return this.update(
      this.#records,
      nextSelections,
      [accountSelectionWrites.put(accountSelectionRecord(namespace, accountId))],
      previousAccountId ? [previousAccountId, accountId] : [accountId],
      [namespace],
    );
  }

  prepareSetAccountHidden(accountId: AccountId, hidden: boolean): AccountHiddenUpdate {
    const current = this.requireAccountRecord(accountId);
    if (current.hidden === hidden) {
      return {
        ...this.update(this.#records, this.#selections, [], [], []),
        account: this.toAccount(current),
        replacementAccount: null,
      };
    }

    const namespace = getAccountIdNamespace(accountId);
    let replacement: AccountRecord | null = null;

    if (hidden) {
      if (current.origin.type !== "hd") throw new PrivateKeyAccountHiddenUnsupportedError(accountId);
      const candidate = findAccountHideReplacement(current, this.listAccountRecords());
      if (!candidate) throw new LastVisibleAccountHiddenError({ accountId, hdKeyringId: current.origin.hdKeyringId });

      if (this.#selections.get(namespace) === accountId) replacement = candidate;
    }

    const update = this.prepareAccountUpdate({ ...current, hidden }, replacement?.accountId);
    return {
      ...update,
      replacementAccount: replacement ? this.toAccount(replacement, update.nextSelections) : null,
    };
  }

  prepareRemoveHdAccounts(hdKeyringIds: readonly HdKeyringId[]): AccountsRemovalUpdate | null {
    return this.prepareRemoveRecords(this.listHdAccountRecords(hdKeyringIds));
  }

  prepareRemovePrivateKeyAccounts(keySourceIds: readonly KeySourceId[]): AccountsRemovalUpdate | null {
    return this.prepareRemoveRecords(this.listPrivateKeyAccountRecords(keySourceIds));
  }

  applyCommittedUpdate(update: AccountsUpdate): void {
    this.#records = update.nextRecords;
    this.#selections = update.nextSelections;
  }

  private async commitUpdate(prepare: () => AccountsUpdate | null): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const update = prepare();
      if (!update) return;

      await commit(update.persistenceChanges);

      this.applyCommittedUpdate(update);
      this.#publishChanged(accountsChangedFromUpdate(update));
    });
  }

  private requireAccountRecord(accountId: AccountId): AccountRecord {
    const record = this.#records.get(accountId);
    if (!record) throw new AccountNotFoundError(accountId);
    return record;
  }

  private prepareRemoveRecords(records: readonly AccountRecord[]): AccountsRemovalUpdate | null {
    if (records.length === 0) return null;

    const removedAccountIds = new Set(records.map((record) => record.accountId));
    const nextRecords = new Map(this.#records);
    for (const record of records) nextRecords.delete(record.accountId);

    const changedAccountIds = records.map((record) => record.accountId);
    const changedNamespaces = uniqueSortedStrings(records.map((record) => getAccountIdNamespace(record.accountId)));
    const nextSelections = new Map(this.#selections);
    const persistenceChanges: PersistenceChange[] = records.map((record) => accountWrites.remove(record.accountId));

    for (const namespace of changedNamespaces) {
      const remaining = sortRecords(
        [...nextRecords.values()].filter((record) => getAccountIdNamespace(record.accountId) === namespace),
      );

      if (remaining.length === 0) {
        nextSelections.delete(namespace);
        persistenceChanges.push(accountSelectionWrites.remove(namespace));
        continue;
      }

      const selectedAccountId = this.#selections.get(namespace);
      if (selectedAccountId && !removedAccountIds.has(selectedAccountId)) continue;

      const replacement = remaining.find((record) => !record.hidden);
      if (!replacement) throw new AccountRemovalSelectionUnavailableError(namespace);

      nextSelections.set(namespace, replacement.accountId);
      changedAccountIds.push(replacement.accountId);
      persistenceChanges.push(accountSelectionWrites.put(accountSelectionRecord(namespace, replacement.accountId)));
    }

    return {
      ...this.update(nextRecords, nextSelections, persistenceChanges, changedAccountIds, changedNamespaces),
      removedAccountIds: uniqueSortedStrings([...removedAccountIds]),
    };
  }

  private toAccount(record: AccountRecord, selections = this.#selections): Account {
    const namespace = getAccountIdNamespace(record.accountId);
    return {
      ...record,
      namespace,
      selected: selections.get(namespace) === record.accountId,
    };
  }

  private update(
    nextRecords: ReadonlyMap<AccountId, AccountRecord>,
    nextSelections: ReadonlyMap<Namespace, AccountId>,
    persistenceChanges: readonly PersistenceChange[],
    changedAccountIds: readonly AccountId[],
    changedNamespaces: readonly Namespace[],
  ): AccountsUpdate {
    return {
      nextRecords,
      nextSelections,
      persistenceChanges,
      changedAccountIds: uniqueSortedStrings(changedAccountIds),
      changedNamespaces: uniqueSortedStrings(changedNamespaces),
    };
  }
}

export const accountsChangedFromUpdate = (update: AccountsUpdate): AccountsChanged => ({
  type: "accountsChanged",
  accountIds: update.changedAccountIds,
  namespaces: update.changedNamespaces,
});
