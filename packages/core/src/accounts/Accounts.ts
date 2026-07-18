import { parseChainRef } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { Namespace } from "../namespaces/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { type AccountId, getAccountIdNamespace } from "./accountId.js";
import type { AccountsBootstrap } from "./bootstrap.js";
import {
  AccountAlreadyExistsError,
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
  AccountRemovalSelectionUnavailableError,
  AccountSelectionMissingError,
  AccountSelectionNamespaceMismatchError,
  AccountSelectionTargetHiddenError,
  AccountSelectionTargetMissingError,
  AccountSelectionUnexpectedError,
  LastVisibleAccountHiddenError,
  PrivateKeyAccountHiddenUnsupportedError,
} from "./errors.js";
import { type AccountsNamespaceAdapters, getAccountsNamespaceAdapter } from "./namespaceAdapter.js";
import {
  type AccountRecord,
  type AccountSelectionRecord,
  accountPersistenceType,
  accountSelectionPersistenceType,
} from "./persistence.js";
import type { Account, AccountAddress, AccountsChanged } from "./types.js";

export type AccountsUpdate = Readonly<{
  nextRecords: ReadonlyMap<AccountId, AccountRecord>;
  nextSelections: ReadonlyMap<Namespace, AccountId>;
  persistenceChanges: readonly PersistenceChange[];
  changedAccountIds: readonly AccountId[];
  changedNamespaces: readonly Namespace[];
}>;

export type AccountsRemovalUpdate = AccountsUpdate &
  Readonly<{
    removedAccountIds: readonly AccountId[];
  }>;

const EMPTY_BOOTSTRAP: AccountsBootstrap = { records: [], selections: [] };

const sortRecords = (records: readonly AccountRecord[]): AccountRecord[] =>
  [...records].sort((left, right) => left.createdAt - right.createdAt || left.accountId.localeCompare(right.accountId));

const uniqueSorted = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();

const accountSelectionRecord = (namespace: Namespace, accountId: AccountId): AccountSelectionRecord => ({
  namespace,
  accountId,
});

type AccountsOptions = Readonly<{
  adapters: AccountsNamespaceAdapters;
  bootstrap?: AccountsBootstrap;
  mutations: CoreMutationQueue;
  /** Publishes committed account changes and must not throw. */
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

    this.assertBootstrapState();
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
        chainNamespace,
      });
    }

    const address = getAccountsNamespaceAdapter(this.#adapters, accountNamespace).addressForAccountId(input);
    return { accountId: input.accountId, chainRef: input.chainRef, ...address };
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

  prepareAddAccount(account: Omit<AccountRecord, "hidden">): AccountsUpdate {
    const namespace = getAccountIdNamespace(account.accountId);
    getAccountsNamespaceAdapter(this.#adapters, namespace);
    if (this.#records.has(account.accountId)) throw new AccountAlreadyExistsError(account.accountId);

    const record: AccountRecord = { ...account, hidden: false };

    const nextRecords = new Map(this.#records);
    nextRecords.set(record.accountId, record);

    const nextSelections = new Map(this.#selections);
    const persistenceChanges: PersistenceChange[] = [persistenceChange.put(accountPersistenceType, record)];

    if (!this.hasAccountsInNamespace(namespace)) {
      nextSelections.set(namespace, record.accountId);
      persistenceChanges.push(
        persistenceChange.put(accountSelectionPersistenceType, accountSelectionRecord(namespace, record.accountId)),
      );
    }

    return this.update(nextRecords, nextSelections, persistenceChanges, [record.accountId], [namespace]);
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
      [persistenceChange.put(accountPersistenceType, renamed)],
      [accountId],
      [getAccountIdNamespace(accountId)],
    );
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
      [persistenceChange.put(accountSelectionPersistenceType, accountSelectionRecord(namespace, accountId))],
      previousAccountId ? [previousAccountId, accountId] : [accountId],
      [namespace],
    );
  }

  prepareSetAccountHidden(accountId: AccountId, hidden: boolean): AccountsUpdate | null {
    const current = this.requireAccountRecord(accountId);
    if (current.hidden === hidden) return null;
    if (hidden && current.origin.type !== "hd") throw new PrivateKeyAccountHiddenUnsupportedError(accountId);

    const namespace = getAccountIdNamespace(accountId);
    const persistenceChanges: PersistenceChange[] = [];
    const nextRecords = new Map(this.#records);
    const nextSelections = new Map(this.#selections);
    const changedAccountIds: AccountId[] = [accountId];

    if (hidden) {
      const replacement = this.listVisibleRecords(namespace).find((record) => record.accountId !== accountId);
      if (!replacement) throw new LastVisibleAccountHiddenError({ accountId, namespace });

      if (this.#selections.get(namespace) === accountId) {
        nextSelections.set(namespace, replacement.accountId);
        persistenceChanges.push(
          persistenceChange.put(
            accountSelectionPersistenceType,
            accountSelectionRecord(namespace, replacement.accountId),
          ),
        );
        changedAccountIds.push(replacement.accountId);
      }
    }

    const updated = { ...current, hidden };
    nextRecords.set(accountId, updated);
    persistenceChanges.unshift(persistenceChange.put(accountPersistenceType, updated));

    return this.update(nextRecords, nextSelections, persistenceChanges, changedAccountIds, [namespace]);
  }

  prepareRemoveHdAccounts(hdKeyringIds: readonly HdKeyringId[]): AccountsRemovalUpdate | null {
    return this.prepareRemoveRecords(this.listHdAccountRecords(hdKeyringIds));
  }

  prepareRemovePrivateKeyAccounts(keySourceIds: readonly KeySourceId[]): AccountsRemovalUpdate | null {
    return this.prepareRemoveRecords(this.listPrivateKeyAccountRecords(keySourceIds));
  }

  prepareReset(): AccountsRemovalUpdate | null {
    return this.prepareRemoveRecords(this.listAccountRecords());
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

  private hasAccountsInNamespace(namespace: Namespace): boolean {
    return [...this.#records.keys()].some((accountId) => getAccountIdNamespace(accountId) === namespace);
  }

  private listVisibleRecords(namespace: Namespace): readonly AccountRecord[] {
    return this.listAccountRecords().filter(
      (record) => getAccountIdNamespace(record.accountId) === namespace && !record.hidden,
    );
  }

  private prepareRemoveRecords(records: readonly AccountRecord[]): AccountsRemovalUpdate | null {
    if (records.length === 0) return null;

    const removedAccountIds = new Set(records.map((record) => record.accountId));
    const nextRecords = new Map(this.#records);
    for (const record of records) nextRecords.delete(record.accountId);

    const changedAccountIds = records.map((record) => record.accountId);
    const changedNamespaces = uniqueSorted(records.map((record) => getAccountIdNamespace(record.accountId)));
    const nextSelections = new Map(this.#selections);
    const persistenceChanges: PersistenceChange[] = records.map((record) =>
      persistenceChange.remove(accountPersistenceType, record.accountId),
    );

    for (const namespace of changedNamespaces) {
      const remaining = sortRecords(
        [...nextRecords.values()].filter((record) => getAccountIdNamespace(record.accountId) === namespace),
      );

      if (remaining.length === 0) {
        nextSelections.delete(namespace);
        persistenceChanges.push(persistenceChange.remove(accountSelectionPersistenceType, namespace));
        continue;
      }

      const selectedAccountId = this.#selections.get(namespace);
      if (selectedAccountId && !removedAccountIds.has(selectedAccountId)) continue;

      const replacement = remaining.find((record) => !record.hidden);
      if (!replacement) throw new AccountRemovalSelectionUnavailableError(namespace);

      nextSelections.set(namespace, replacement.accountId);
      changedAccountIds.push(replacement.accountId);
      persistenceChanges.push(
        persistenceChange.put(
          accountSelectionPersistenceType,
          accountSelectionRecord(namespace, replacement.accountId),
        ),
      );
    }

    return {
      ...this.update(nextRecords, nextSelections, persistenceChanges, changedAccountIds, changedNamespaces),
      removedAccountIds: uniqueSorted([...removedAccountIds]),
    };
  }

  private toAccount(record: AccountRecord): Account {
    const namespace = getAccountIdNamespace(record.accountId);
    return {
      ...record,
      namespace,
      selected: this.#selections.get(namespace) === record.accountId,
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
      changedAccountIds: uniqueSorted(changedAccountIds),
      changedNamespaces: uniqueSorted(changedNamespaces),
    };
  }

  private assertBootstrapState(): void {
    const accountNamespaces = new Set<Namespace>();
    for (const accountId of this.#records.keys()) {
      accountNamespaces.add(getAccountIdNamespace(accountId));
    }

    for (const namespace of uniqueSorted([...accountNamespaces])) {
      getAccountsNamespaceAdapter(this.#adapters, namespace);

      const accountId = this.#selections.get(namespace);
      if (!accountId) throw new AccountSelectionMissingError(namespace);

      const selected = this.#records.get(accountId);
      if (!selected) throw new AccountSelectionTargetMissingError({ namespace, accountId });

      const accountNamespace = getAccountIdNamespace(accountId);
      if (accountNamespace !== namespace) {
        throw new AccountSelectionNamespaceMismatchError({ namespace, accountId, accountNamespace });
      }

      if (selected.hidden) throw new AccountSelectionTargetHiddenError({ namespace, accountId });
    }

    for (const [namespace, accountId] of this.#selections) {
      if (!accountNamespaces.has(namespace)) throw new AccountSelectionUnexpectedError({ namespace, accountId });
    }
  }
}

export const accountsChangedFromUpdate = (update: AccountsUpdate): AccountsChanged => ({
  type: "accountsChanged",
  accountIds: update.changedAccountIds,
  namespaces: update.changedNamespaces,
});
