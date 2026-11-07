import type { KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import { type ChainRef, parseChainRef } from "../networks/chainRef.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { uniqueSortedStrings } from "../utils/array.js";
import type { AccountGroupId } from "./accountGroupId.js";
import { type AccountId, getAccountIdNamespace } from "./accountId.js";
import { findAccountHideReplacement } from "./accountVisibility.js";
import type { AccountsBootstrap } from "./bootstrap.js";
import {
  AccountAlreadyExistsError,
  AccountGroupNotFoundError,
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountRemovalSelectionUnavailableError,
  AccountSelectionMissingError,
  LastVisibleAccountHiddenError,
  PrivateKeyAccountHiddenUnsupportedError,
} from "./errors.js";
import { type AccountsNamespaceAdapters, getAccountsNamespaceAdapter } from "./namespaceAdapter.js";
import {
  type AccountGroupRecord,
  type AccountMemberRecord,
  accountGroupWrites,
  accountSelectionWrites,
  accountWrites,
} from "./persistence.js";
import type { AccountAddress, AccountGroup, AccountMember, AccountsChanged, Address } from "./types.js";

export type AccountsUpdate = Readonly<{
  nextGroups: ReadonlyMap<AccountGroupId, AccountGroupRecord>;
  nextRecords: ReadonlyMap<AccountId, AccountMemberRecord>;
  nextSelection: AccountGroupId | null;
  persistenceChanges: readonly PersistenceChange[];
  changedAccountGroupIds: readonly AccountGroupId[];
  changedAccountIds: readonly AccountId[];
}>;

export type AccountGroupUpdate = AccountsUpdate & Readonly<{ account: AccountGroup }>;
export type AccountHiddenUpdate = AccountGroupUpdate & Readonly<{ replacementAccount: AccountGroup | null }>;
export type AccountsRemovalUpdate = AccountsUpdate & Readonly<{ removedAccountIds: readonly AccountId[] }>;

type NewMember = Omit<AccountMemberRecord, "accountGroupId">;

const EMPTY_BOOTSTRAP: AccountsBootstrap = { groups: [], records: [], selection: null };
const sortGroups = (groups: readonly AccountGroupRecord[]): AccountGroupRecord[] =>
  [...groups].sort(
    (left, right) => left.createdAt - right.createdAt || left.accountGroupId.localeCompare(right.accountGroupId),
  );

type AccountsOptions = Readonly<{
  adapters: AccountsNamespaceAdapters;
  bootstrap?: AccountsBootstrap;
  mutations: CoreMutationQueue;
  publishChanged(change: AccountsChanged): void;
}>;

/** Owns user account groups, their namespace members, and the wallet's sole account selection. */
export class Accounts {
  readonly #adapters: AccountsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: AccountsOptions["publishChanged"];
  #groups: ReadonlyMap<AccountGroupId, AccountGroupRecord>;
  #records: ReadonlyMap<AccountId, AccountMemberRecord>;
  #selection: AccountGroupId | null;

  constructor(options: AccountsOptions) {
    const bootstrap = options.bootstrap ?? EMPTY_BOOTSTRAP;
    this.#adapters = options.adapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#groups = new Map(bootstrap.groups.map((group) => [group.accountGroupId, group]));
    this.#records = new Map(bootstrap.records.map((record) => [record.accountId, record]));
    this.#selection = bootstrap.selection?.accountGroupId ?? null;
  }

  getGroupRecord(accountGroupId: AccountGroupId): AccountGroupRecord | null {
    return this.#groups.get(accountGroupId) ?? null;
  }

  listGroupRecords(): readonly AccountGroupRecord[] {
    return sortGroups([...this.#groups.values()]);
  }

  getMemberRecord(accountId: AccountId): AccountMemberRecord | null {
    return this.#records.get(accountId) ?? null;
  }

  listMemberRecords(accountGroupId?: AccountGroupId): readonly AccountMemberRecord[] {
    return [...this.#records.values()]
      .filter((record) => accountGroupId === undefined || record.accountGroupId === accountGroupId)
      .sort((left, right) => left.accountId.localeCompare(right.accountId));
  }

  getMember(accountId: AccountId): AccountMember | null {
    const record = this.getMemberRecord(accountId);
    return record ? this.toMember(record) : null;
  }

  getGroup(accountGroupId: AccountGroupId): AccountGroup | null {
    const group = this.getGroupRecord(accountGroupId);
    return group ? this.toGroup(group) : null;
  }

  getGroupForMember(accountId: AccountId): AccountGroup | null {
    const member = this.getMemberRecord(accountId);
    return member ? this.getGroup(member.accountGroupId) : null;
  }

  listGroups(): readonly AccountGroup[] {
    return this.listGroupRecords().map((group) => this.toGroup(group));
  }

  getSelectedGroupId(): AccountGroupId | null {
    return this.#selection;
  }

  getSelectedGroup(): AccountGroup {
    if (this.#selection === null) throw new AccountSelectionMissingError();
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

  accountIdFromAddress(input: { namespace: Namespace; address: string }): AccountId {
    return getAccountsNamespaceAdapter(this.#adapters, input.namespace).accountIdFromAddress(input);
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

  getMemberAddresses(input: { accountId: AccountId }): readonly Address[] {
    const namespace = getAccountIdNamespace(input.accountId);
    const { displayAddress } = getAccountsNamespaceAdapter(this.#adapters, namespace).addressForAccountId(input);
    return [{ accountId: input.accountId, address: displayAddress, namespace }];
  }

  getGroupAddresses(input: { accountGroupId: AccountGroupId }): readonly Address[] {
    this.requireGroupRecord(input.accountGroupId);
    return this.listMemberRecords(input.accountGroupId).flatMap((record) => this.getMemberAddresses(record));
  }

  listSelectableAddresses(chainRef: ChainRef): readonly AccountAddress[] {
    const { namespace } = parseChainRef(chainRef);
    getAccountsNamespaceAdapter(this.#adapters, namespace);
    return this.listGroupRecords()
      .filter((group) => !group.hidden)
      .flatMap((group) => this.listMemberRecords(group.accountGroupId))
      .filter((member) => getAccountIdNamespace(member.accountId) === namespace)
      .map((member) => this.getAddress({ chainRef, accountId: member.accountId }));
  }

  rename(input: { accountGroupId: AccountGroupId; alias?: string }): Promise<void> {
    return this.commitUpdate(() => this.prepareRenameGroup(input.accountGroupId, input.alias));
  }

  select(accountGroupId: AccountGroupId): Promise<void> {
    return this.commitUpdate(() => this.prepareSelectGroup(accountGroupId));
  }

  prepareAddGroup(
    group: Omit<AccountGroupRecord, "hidden">,
    members: readonly NewMember[],
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): AccountGroupUpdate {
    for (const member of members) {
      getAccountsNamespaceAdapter(this.#adapters, getAccountIdNamespace(member.accountId));
      if (this.#records.has(member.accountId)) throw new AccountAlreadyExistsError(member.accountId);
    }
    return this.prepareGroupUpdate({ ...group, hidden: false }, members, selectAsCurrent || this.#selection === null);
  }

  /** The complete wallet command verifies that the new source controls every retained member. */
  prepareMoveGroup(
    accountGroupId: AccountGroupId,
    source: AccountGroupRecord["source"],
    members: readonly NewMember[],
    { selectAsCurrent = false }: { selectAsCurrent?: boolean } = {},
  ): AccountGroupUpdate {
    return this.prepareGroupUpdate({ ...this.requireGroupRecord(accountGroupId), source }, members, selectAsCurrent);
  }

  private prepareRenameGroup(accountGroupId: AccountGroupId, alias: string | undefined): AccountsUpdate | null {
    const current = this.requireGroupRecord(accountGroupId);
    if (current.alias === alias) return null;
    const { alias: _alias, ...withoutAlias } = current;
    return this.prepareGroupUpdate(alias === undefined ? withoutAlias : { ...withoutAlias, alias });
  }

  private prepareSelectGroup(accountGroupId: AccountGroupId): AccountsUpdate | null {
    const group = this.requireGroupRecord(accountGroupId);
    if (group.hidden) throw new AccountHiddenSelectionError({ accountGroupId });
    if (this.#selection === accountGroupId) return null;
    const changed = [accountGroupId, ...(this.#selection === null ? [] : [this.#selection])];
    return this.update(
      this.#groups,
      this.#records,
      accountGroupId,
      [accountSelectionWrites.put({ accountGroupId })],
      changed,
    );
  }

  prepareSetGroupHidden(accountGroupId: AccountGroupId, hidden: boolean): AccountHiddenUpdate {
    const current = this.requireGroupRecord(accountGroupId);
    if (current.hidden === hidden) {
      return {
        ...this.update(this.#groups, this.#records, this.#selection, [], []),
        account: this.toGroup(current),
        replacementAccount: null,
      };
    }
    let replacement: AccountGroupRecord | null = null;
    if (hidden) {
      if (current.source.type !== "bip39") throw new PrivateKeyAccountHiddenUnsupportedError(accountGroupId);
      const candidate = findAccountHideReplacement(current, this.listGroupRecords());
      if (!candidate)
        throw new LastVisibleAccountHiddenError({ accountGroupId, keySourceId: current.source.keySourceId });
      if (this.#selection === accountGroupId) replacement = candidate;
    }
    const update = this.prepareGroupUpdate({ ...current, hidden }, [], false, replacement?.accountGroupId);
    return {
      ...update,
      replacementAccount: replacement ? this.toGroup(replacement, update.nextRecords, update.nextSelection) : null,
    };
  }

  prepareRemoveSourceGroups(keySourceId: KeySourceId): AccountsRemovalUpdate | null {
    const removed = this.listGroupRecords().filter((group) => group.source.keySourceId === keySourceId);
    if (removed.length === 0) return null;
    const removedGroupIds = new Set(removed.map((group) => group.accountGroupId));
    const members = this.listMemberRecords().filter((member) => removedGroupIds.has(member.accountGroupId));
    const nextGroups = new Map(this.#groups);
    for (const group of removed) nextGroups.delete(group.accountGroupId);
    const nextRecords = new Map(this.#records);
    for (const member of members) nextRecords.delete(member.accountId);
    const persistenceChanges: PersistenceChange[] = [
      ...removed.map((group) => accountGroupWrites.remove(group.accountGroupId)),
      ...members.map((member) => accountWrites.remove(member.accountId)),
    ];
    let nextSelection = this.#selection;
    const changedGroupIds = [...removedGroupIds];
    if (nextSelection !== null && removedGroupIds.has(nextSelection)) {
      const replacement = sortGroups([...nextGroups.values()]).find((group) => !group.hidden);
      if (!replacement && nextGroups.size > 0) throw new AccountRemovalSelectionUnavailableError();
      nextSelection = replacement?.accountGroupId ?? null;
      persistenceChanges.push(
        nextSelection === null
          ? accountSelectionWrites.remove()
          : accountSelectionWrites.put({ accountGroupId: nextSelection }),
      );
      if (nextSelection !== null) changedGroupIds.push(nextSelection);
    }
    return {
      ...this.update(
        nextGroups,
        nextRecords,
        nextSelection,
        persistenceChanges,
        changedGroupIds,
        members.map((member) => member.accountId),
      ),
      removedAccountIds: members.map((member) => member.accountId),
    };
  }

  applyCommittedUpdate(update: AccountsUpdate): void {
    this.#groups = update.nextGroups;
    this.#records = update.nextRecords;
    this.#selection = update.nextSelection;
  }

  private prepareGroupUpdate(
    group: AccountGroupRecord,
    members: readonly NewMember[] = [],
    selectAsCurrent = false,
    replacementSelection?: AccountGroupId,
  ): AccountGroupUpdate {
    const nextGroups = new Map(this.#groups);
    nextGroups.set(group.accountGroupId, group);
    const nextRecords = new Map(this.#records);
    const changes: PersistenceChange[] = [accountGroupWrites.put(group)];
    for (const member of members) {
      const current = nextRecords.get(member.accountId);
      if (current && current.accountGroupId !== group.accountGroupId)
        throw new AccountAlreadyExistsError(member.accountId);
      const record = { ...member, accountGroupId: group.accountGroupId };
      nextRecords.set(member.accountId, record);
      changes.push(accountWrites.put(record));
    }
    const nextSelection = replacementSelection ?? (selectAsCurrent ? group.accountGroupId : this.#selection);
    const changedGroupIds = [group.accountGroupId];
    if (nextSelection !== this.#selection && nextSelection !== null) {
      changes.push(accountSelectionWrites.put({ accountGroupId: nextSelection }));
      if (this.#selection !== null) changedGroupIds.push(this.#selection);
      changedGroupIds.push(nextSelection);
    }
    return {
      ...this.update(nextGroups, nextRecords, nextSelection, changes, changedGroupIds),
      account: this.toGroup(group, nextRecords, nextSelection),
    };
  }

  private update(
    nextGroups: ReadonlyMap<AccountGroupId, AccountGroupRecord>,
    nextRecords: ReadonlyMap<AccountId, AccountMemberRecord>,
    nextSelection: AccountGroupId | null,
    persistenceChanges: readonly PersistenceChange[],
    groupIds: readonly AccountGroupId[],
    removedAccountIds: readonly AccountId[] = [],
  ): AccountsUpdate {
    const changedAccountGroupIds = uniqueSortedStrings(groupIds);
    const changed = new Set(changedAccountGroupIds);
    return {
      nextGroups,
      nextRecords,
      nextSelection,
      persistenceChanges,
      changedAccountGroupIds,
      changedAccountIds: uniqueSortedStrings([
        ...removedAccountIds,
        ...[...nextRecords.values()]
          .filter((record) => changed.has(record.accountGroupId))
          .map((record) => record.accountId),
      ]),
    };
  }

  private requireGroupRecord(accountGroupId: AccountGroupId): AccountGroupRecord {
    const group = this.#groups.get(accountGroupId);
    if (!group) throw new AccountGroupNotFoundError(accountGroupId);
    return group;
  }

  private toMember(record: AccountMemberRecord, group = this.requireGroupRecord(record.accountGroupId)): AccountMember {
    return { ...record, namespace: getAccountIdNamespace(record.accountId), hidden: group.hidden };
  }

  private toGroup(group: AccountGroupRecord, records = this.#records, selection = this.#selection): AccountGroup {
    const members = [...records.values()]
      .filter((record) => record.accountGroupId === group.accountGroupId)
      .sort((left, right) => left.accountId.localeCompare(right.accountId))
      .map((record) => this.toMember(record, group));
    // Complete wallet commands keep every group linked to at least one member.
    return {
      ...group,
      members: members as [AccountMember, ...AccountMember[]],
      selected: selection === group.accountGroupId,
    };
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
}

export const accountsChangedFromUpdate = (update: AccountsUpdate): AccountsChanged => ({
  type: "accountsChanged",
  accountGroupIds: update.changedAccountGroupIds,
  accountIds: update.changedAccountIds,
  namespaces: uniqueSortedStrings(update.changedAccountIds.map(getAccountIdNamespace)),
});
