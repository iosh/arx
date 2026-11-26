import type { KeySourceId } from "../keyring/types.js";
import { type ChainRef, splitChainRef } from "../networks/chainRef.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { commitUpdates, type PreparedUpdate } from "../persistence/preparedUpdate.js";
import { uniqueSortedStrings } from "../utils/array.js";
import type { AccountGroupId } from "./accountGroupId.js";
import { type AccountId, getAccountIdNamespace } from "./accountId.js";
import { findAccountHideReplacement } from "./accountVisibility.js";
import type { AccountsBootstrap } from "./bootstrap.js";
import {
  AccountGroupNotFoundError,
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  LastVisibleAccountHiddenError,
} from "./errors.js";
import type { AccountsNamespaceAdapters } from "./namespaceAdapter.js";
import { type AccountGroupRecord, accountGroupWrites, accountSelectionWrites } from "./persistence.js";
import type { Account, AccountAddress, AccountGroup, AccountPreview, AccountsChanged } from "./types.js";

type PreparedAccountGroup = Readonly<{ update: PreparedUpdate; accountGroup: AccountGroup }>;

const sortGroups = (groups: Iterable<AccountGroupRecord>): AccountGroupRecord[] =>
  [...groups].sort(
    (left, right) => left.createdAt - right.createdAt || left.accountGroupId.localeCompare(right.accountGroupId),
  );

const indexAccounts = (groups: Iterable<AccountGroupRecord>): ReadonlyMap<AccountId, AccountGroupId> =>
  new Map(
    [...groups].flatMap((group) => group.accounts.map((account) => [account.accountId, group.accountGroupId] as const)),
  );

type AccountsOptions = Readonly<{
  adapters: AccountsNamespaceAdapters;
  bootstrap: AccountsBootstrap;
  mutations: CoreMutationQueue;
  publishChanged(change: AccountsChanged): void;
}>;

/** Owns account groups, their accounts, and the wallet's selected group. */
export class Accounts {
  readonly #adapters: AccountsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: AccountsOptions["publishChanged"];
  #groups: ReadonlyMap<AccountGroupId, AccountGroupRecord>;
  #groupIdsByAccountId: ReadonlyMap<AccountId, AccountGroupId>;
  #selection: AccountGroupId | null;

  constructor(options: AccountsOptions) {
    this.#adapters = options.adapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#groups = new Map(options.bootstrap.groups.map((group) => [group.accountGroupId, group]));
    this.#groupIdsByAccountId = indexAccounts(this.#groups.values());
    this.#selection = options.bootstrap.selection?.accountGroupId ?? null;
  }

  getAccount(accountId: AccountId): Account | null {
    const groupId = this.#groupIdsByAccountId.get(accountId);
    return groupId === undefined ? null : this.toAccount(accountId, this.requireGroupRecord(groupId));
  }

  getGroup(accountGroupId: AccountGroupId): AccountGroup | null {
    const group = this.#groups.get(accountGroupId);
    return group ? this.toGroup(group) : null;
  }

  getGroupForAccount(accountId: AccountId): AccountGroup | null {
    const groupId = this.#groupIdsByAccountId.get(accountId);
    return groupId === undefined ? null : this.getGroup(groupId);
  }

  listGroups(): readonly AccountGroup[] {
    return sortGroups(this.#groups.values()).map((group) => this.toGroup(group));
  }

  getSelectedGroup(): AccountGroup {
    if (this.#selection === null) throw new Error("Wallet account selection is missing.");
    return this.toGroup(this.requireGroupRecord(this.#selection));
  }

  nextAccountIndex(keySourceId: KeySourceId): number {
    let lastIndex = -1;
    for (const group of this.#groups.values()) {
      if (group.source.type === "bip39" && group.source.keySourceId === keySourceId) {
        lastIndex = Math.max(lastIndex, group.source.accountIndex);
      }
    }
    return lastIndex + 1;
  }

  /** Projects public identity fields without requiring a saved account group. */
  getPublicIdentity(accountId: AccountId): AccountPreview {
    const namespace = getAccountIdNamespace(accountId);
    const { displayAddress } = this.#adapters[namespace].addressForAccountId({ accountId });
    return { accountId, namespace, defaultAddress: displayAddress };
  }

  getAddress(input: { chainRef: ChainRef; accountId: AccountId }): AccountAddress {
    const { namespace: chainNamespace } = splitChainRef(input.chainRef);
    const accountNamespace = getAccountIdNamespace(input.accountId);
    if (accountNamespace !== chainNamespace) {
      throw new AccountNamespaceMismatchError({
        accountId: input.accountId,
        accountNamespace,
        expectedNamespace: chainNamespace,
      });
    }
    const address = this.#adapters[accountNamespace].addressForAccountId(input);
    return { accountId: input.accountId, chainRef: input.chainRef, ...address };
  }

  listSelectableAddresses(chainRef: ChainRef): readonly AccountAddress[] {
    const { namespace } = splitChainRef(chainRef);
    return sortGroups(this.#groups.values())
      .filter((group) => !group.hidden)
      .flatMap((group) => group.accounts)
      .filter((account) => getAccountIdNamespace(account.accountId) === namespace)
      .map((account) => this.getAddress({ chainRef, accountId: account.accountId }));
  }

  rename(input: { accountGroupId: AccountGroupId; alias?: string }): Promise<void> {
    return this.commitUpdate(() => this.prepareRenameGroup(input.accountGroupId, input.alias));
  }

  select(accountGroupId: AccountGroupId): Promise<void> {
    return this.commitUpdate(() => this.prepareSelectGroup(accountGroupId));
  }

  prepareAddGroup(
    group: Omit<AccountGroupRecord, "hidden">,
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): PreparedAccountGroup {
    return this.prepareGroupUpdate({
      group: { ...group, hidden: false },
      nextSelection: selectAsCurrent || this.#selection === null ? group.accountGroupId : this.#selection,
    });
  }

  /** The wallet command verifies that the new source controls every retained account. */
  prepareMoveGroup(
    accountGroupId: AccountGroupId,
    source: AccountGroupRecord["source"],
    accounts: AccountGroupRecord["accounts"],
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): PreparedAccountGroup {
    return this.prepareGroupUpdate({
      group: { ...this.requireGroupRecord(accountGroupId), source, accounts },
      nextSelection: selectAsCurrent ? accountGroupId : this.#selection,
    });
  }

  /** Visibility commands refresh connections. Hiding also commits permission cleanup and cancels affected approvals afterward. */
  prepareSetGroupHidden(
    accountGroupId: AccountGroupId,
    hidden: boolean,
  ): Readonly<{
    update: PreparedUpdate | null;
    accountGroup: AccountGroup;
    replacementGroup: AccountGroup | null;
  }> {
    const current = this.requireGroupRecord(accountGroupId);
    if (current.hidden === hidden) return { update: null, accountGroup: this.toGroup(current), replacementGroup: null };
    let replacement: AccountGroupRecord | null = null;
    if (hidden) {
      const candidate = findAccountHideReplacement(current, sortGroups(this.#groups.values()));
      if (!candidate)
        throw new LastVisibleAccountHiddenError({ accountGroupId, keySourceId: current.source.keySourceId });
      if (this.#selection === accountGroupId) replacement = candidate;
    }
    const preparation = this.prepareGroupUpdate({
      group: { ...current, hidden },
      nextSelection: replacement?.accountGroupId ?? this.#selection,
    });
    return {
      ...preparation,
      replacementGroup: replacement ? this.toGroup(replacement, replacement.accountGroupId) : null,
    };
  }

  /** The wallet command commits source removal and permission cleanup together, then cancels approvals and refreshes connections. */
  prepareRemoveSourceGroups(keySourceId: KeySourceId): Readonly<{
    update: PreparedUpdate | null;
    removedAccountIds: readonly AccountId[];
  }> {
    const removed = sortGroups(this.#groups.values()).filter((group) => group.source.keySourceId === keySourceId);
    if (removed.length === 0) return { update: null, removedAccountIds: [] };
    const removedGroupIds = new Set(removed.map((group) => group.accountGroupId));
    const nextGroups = new Map(this.#groups);
    for (const group of removed) nextGroups.delete(group.accountGroupId);
    const persistenceChanges: PersistenceChange[] = removed.map((group) =>
      accountGroupWrites.remove(group.accountGroupId),
    );
    let nextSelection = this.#selection;
    const changedGroupIds = [...removedGroupIds];
    if (nextSelection !== null && removedGroupIds.has(nextSelection)) {
      const replacement = sortGroups(nextGroups.values()).find((group) => !group.hidden);
      if (!replacement && nextGroups.size > 0) throw new Error("Source removal left no visible account selection.");
      nextSelection = replacement?.accountGroupId ?? null;
      persistenceChanges.push(
        nextSelection === null
          ? accountSelectionWrites.remove()
          : accountSelectionWrites.put({ accountGroupId: nextSelection }),
      );
      if (nextSelection !== null) changedGroupIds.push(nextSelection);
    }
    const removedAccountIds = removed.flatMap((group) => group.accounts.map((account) => account.accountId));
    return {
      update: this.prepareUpdate({
        nextGroups,
        nextSelection,
        persistenceChanges,
        changedGroupIds,
        removedAccountIds,
      }),
      removedAccountIds,
    };
  }

  private prepareRenameGroup(accountGroupId: AccountGroupId, alias: string | undefined): PreparedUpdate | null {
    const current = this.requireGroupRecord(accountGroupId);
    if (current.alias === alias) return null;
    const { alias: _alias, ...withoutAlias } = current;
    return this.prepareGroupUpdate({
      group: alias === undefined ? withoutAlias : { ...withoutAlias, alias },
      nextSelection: this.#selection,
    }).update;
  }

  private prepareSelectGroup(accountGroupId: AccountGroupId): PreparedUpdate | null {
    const group = this.requireGroupRecord(accountGroupId);
    if (group.hidden) throw new AccountHiddenSelectionError({ accountGroupId });
    if (this.#selection === accountGroupId) return null;
    return this.prepareUpdate({
      nextGroups: this.#groups,
      nextSelection: accountGroupId,
      persistenceChanges: [accountSelectionWrites.put({ accountGroupId })],
      changedGroupIds: [accountGroupId, ...(this.#selection === null ? [] : [this.#selection])],
    });
  }

  private prepareGroupUpdate({
    group,
    nextSelection,
  }: {
    group: AccountGroupRecord;
    nextSelection: AccountGroupId | null;
  }): PreparedAccountGroup {
    for (const account of group.accounts) {
      const currentGroupId = this.#groupIdsByAccountId.get(account.accountId);
      if (currentGroupId !== undefined && currentGroupId !== group.accountGroupId) {
        throw new Error("Account identity already belongs to another group.");
      }
    }
    const nextGroups = new Map(this.#groups);
    nextGroups.set(group.accountGroupId, group);
    const persistenceChanges: PersistenceChange[] = [accountGroupWrites.put(group)];
    const changedGroupIds = [group.accountGroupId];
    if (nextSelection !== this.#selection && nextSelection !== null) {
      persistenceChanges.push(accountSelectionWrites.put({ accountGroupId: nextSelection }));
      if (this.#selection !== null) changedGroupIds.push(this.#selection);
      changedGroupIds.push(nextSelection);
    }
    return {
      update: this.prepareUpdate({
        nextGroups,
        nextSelection,
        persistenceChanges,
        changedGroupIds,
      }),
      accountGroup: this.toGroup(group, nextSelection),
    };
  }

  private prepareUpdate({
    nextGroups,
    nextSelection,
    persistenceChanges,
    changedGroupIds,
    removedAccountIds = [],
  }: {
    nextGroups: ReadonlyMap<AccountGroupId, AccountGroupRecord>;
    nextSelection: AccountGroupId | null;
    persistenceChanges: readonly PersistenceChange[];
    changedGroupIds: readonly AccountGroupId[];
    removedAccountIds?: readonly AccountId[];
  }): PreparedUpdate {
    const nextIndex = indexAccounts(nextGroups.values());
    const changedAccountGroupIds = uniqueSortedStrings(changedGroupIds);
    const changed = new Set(changedAccountGroupIds);
    const changedAccountIds = uniqueSortedStrings([
      ...removedAccountIds,
      ...[...nextGroups.values()]
        .filter((group) => changed.has(group.accountGroupId))
        .flatMap((group) => group.accounts.map((account) => account.accountId)),
    ]);
    const event: AccountsChanged = {
      type: "accountsChanged",
      accountGroupIds: changedAccountGroupIds,
      accountIds: changedAccountIds,
      namespaces: uniqueSortedStrings(changedAccountIds.map(getAccountIdNamespace)),
    };
    return {
      persistenceChanges,
      activate: () => {
        this.#groups = nextGroups;
        this.#groupIdsByAccountId = nextIndex;
        this.#selection = nextSelection;
      },
      publish: () => this.#publishChanged(event),
    };
  }

  private requireGroupRecord(accountGroupId: AccountGroupId): AccountGroupRecord {
    const group = this.#groups.get(accountGroupId);
    if (!group) throw new AccountGroupNotFoundError(accountGroupId);
    return group;
  }

  private toAccount(accountId: AccountId, group: AccountGroupRecord): Account {
    return { ...this.getPublicIdentity(accountId), accountGroupId: group.accountGroupId, hidden: group.hidden };
  }

  private toGroup(group: AccountGroupRecord, selection = this.#selection): AccountGroup {
    const [first, ...rest] = group.accounts;
    const accounts: [Account, ...Account[]] = [
      this.toAccount(first.accountId, group),
      ...rest.map((account) => this.toAccount(account.accountId, group)),
    ];
    accounts.sort((left, right) => left.accountId.localeCompare(right.accountId));
    return { ...group, accounts, selected: selection === group.accountGroupId };
  }

  private commitUpdate(prepare: () => PreparedUpdate | null): Promise<void> {
    return this.#mutations.run((commit) => commitUpdates(commit, [prepare()]));
  }
}
