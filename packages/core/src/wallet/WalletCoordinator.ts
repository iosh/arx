import type { Accounts } from "../accounts/Accounts.js";
import type { AccountGroupId } from "../accounts/accountGroupId.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import type { AccountGroupRecord } from "../accounts/persistence.js";
import type { AccountGroup } from "../accounts/types.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import { parseBip39Mnemonic } from "../keyring/bip39.js";
import { KeySourceNotFoundError } from "../keyring/errors.js";
import type { Keyring, PreparedKeyringUpdate } from "../keyring/Keyring.js";
import type { BackupStatus, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import type { Permissions } from "../permissions/Permissions.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { commitUpdates, type PreparedUpdate } from "../persistence/preparedUpdate.js";
import type { CoreTime } from "../runtime/time.js";
import { AUTO_LOCK_SETTING_KEY, settingWrites } from "../settings/persistence.js";
import {
  type AutoLockController,
  assertAutoLockDuration,
  DEFAULT_AUTO_LOCK_DURATION_MS,
} from "./AutoLockController.js";
import type { AccountKeys } from "./accountKeys.js";
import { WalletAccountMoveConflictError, WalletLastKeySourceRemovalError, WalletLockedError } from "./errors.js";
import type {
  AddMnemonicAndMoveAccountInput,
  AddMnemonicSourceInput,
  AddMnemonicSourceResult,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  HdAccountGroupCreationResult,
  ImportPrivateKeySourceResult,
  KeySourceAdded,
  MovePrivateKeyAccountInput,
  PrivateKeySourceInput,
  RestoreFromMnemonicInput,
  SetAccountGroupHiddenResult,
  WalletInitializationResult,
  WalletStatus,
  WalletStatusChanged,
} from "./Wallet.js";
import { getWalletStatus } from "./walletStatus.js";

type WalletCoordinatorOptions = Readonly<{
  mutations: CoreMutationQueue;
  namespaces: readonly [Namespace, ...Namespace[]];
  time: CoreTime;
  keyring: Keyring;
  accounts: Accounts;
  accountKeys: Pick<AccountKeys, "exportPrivateKey">;
  permissions: Pick<Permissions, "prepareRemoveAccountReferences">;
  approvals: Pick<Approvals, "cancelByAccounts" | "cancelAll">;
  dappConnections: Pick<DappConnections, "refreshAccountsForOpenConnections">;
  autoLock: AutoLockController;
  publishStatusChanged(change: WalletStatusChanged): void;
}>;

/** Commands that read or change vault material check the session when they begin in the shared queue. Admitted commands finish before expiry locks the session. */
export class WalletCoordinator {
  readonly #mutations: CoreMutationQueue;
  readonly #namespaces: readonly [Namespace, ...Namespace[]];
  readonly #time: CoreTime;
  readonly #keyring: Keyring;
  readonly #accounts: Accounts;
  readonly #accountKeys: WalletCoordinatorOptions["accountKeys"];
  readonly #permissions: WalletCoordinatorOptions["permissions"];
  readonly #approvals: WalletCoordinatorOptions["approvals"];
  readonly #dappConnections: WalletCoordinatorOptions["dappConnections"];
  readonly #autoLock: AutoLockController;
  readonly #publishStatusChanged: WalletCoordinatorOptions["publishStatusChanged"];

  constructor(options: WalletCoordinatorOptions) {
    this.#mutations = options.mutations;
    this.#namespaces = options.namespaces;
    this.#time = options.time;
    this.#keyring = options.keyring;
    this.#accounts = options.accounts;
    this.#accountKeys = options.accountKeys;
    this.#permissions = options.permissions;
    this.#approvals = options.approvals;
    this.#dappConnections = options.dappConnections;
    this.#autoLock = options.autoLock;
    this.#publishStatusChanged = options.publishStatusChanged;
  }

  getStatus(): WalletStatus {
    return getWalletStatus(this.#keyring.getSoftwareKeyStatus(), this.#autoLock.isExpired());
  }

  notifyUserActivity(): void {
    this.#autoLock.recordActivity();
  }

  createFromMnemonic(params: CreateFromMnemonicInput): Promise<WalletInitializationResult> {
    return this.initializeBip39Wallet(params, "pending");
  }

  restoreFromMnemonic(params: RestoreFromMnemonicInput): Promise<WalletInitializationResult> {
    return this.initializeBip39Wallet(params, "confirmed");
  }

  async createFromPrivateKey(params: CreateFromPrivateKeyInput): Promise<WalletInitializationResult> {
    return this.#mutations.run(async (commit) => {
      if (this.#keyring.getSoftwareKeyStatus() !== "uninitialized") return { status: "already-initialized" };
      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareInitializePrivateKeySource({ ...params, createdAt });
      const accountGroupId = crypto.randomUUID();
      const creation = this.#accounts.prepareAddGroup({
        accountGroupId,
        source: { type: "private-key", keySourceId: addition.keySourceId },
        accounts: [{ accountId: addition.accountId }],
        createdAt,
      });
      await this.commitKeyringUpdate(commit, addition.update, [creation.update]);
      this.startUnlockedSession();
      return { status: "initialized", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  async unlock(password: string): Promise<boolean> {
    return this.#mutations.run(async () => {
      this.lockIfExpired();
      if (this.#keyring.getSoftwareKeyStatus() === "unlocked") return true;
      const unlocked = await this.#keyring.prepareUnlock(password);
      if (unlocked === null) return false;
      unlocked.activate();
      this.startUnlockedSession();
      return true;
    });
  }

  async lock(): Promise<void> {
    await this.#mutations.run(async () => this.lockSession());
  }

  async changePassword(params: { currentPassword: string; newPassword: string }): Promise<boolean> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const update = await this.#keyring.prepareChangePassword(params);
      if (update === null) return false;
      await this.commitKeyringUpdate(commit, update);
      return true;
    });
  }

  async setAutoLockDuration(durationMs: number): Promise<void> {
    assertAutoLockDuration(durationMs);
    await this.#mutations.run(async (commit) => {
      if (this.#autoLock.getDuration() === durationMs) return;
      const change =
        durationMs === DEFAULT_AUTO_LOCK_DURATION_MS
          ? settingWrites.remove(AUTO_LOCK_SETTING_KEY)
          : settingWrites.put({ key: AUTO_LOCK_SETTING_KEY, durationMs });
      await commit([change]);
      this.#autoLock.applyDuration(durationMs);
    });
  }

  async addMnemonic(params: AddMnemonicSourceInput): Promise<AddMnemonicSourceResult> {
    const mnemonic = parseBip39Mnemonic(params.mnemonic);
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const existingSource = this.#keyring.findMnemonicSource(mnemonic);
      if (existingSource) return { status: "duplicate", walletName: existingSource.name };
      const derivedAccounts = this.deriveFirstGroupAccounts(mnemonic);
      const candidate = this.findMoveCandidate(derivedAccounts);
      if (candidate) return { status: "move-available", ...candidate };
      const createdAt = this.#time.now();
      const addition = this.#keyring.prepareAddBip39Source({ ...params, mnemonic, createdAt });
      const accountGroupId = crypto.randomUUID();
      const creation = this.#accounts.prepareAddGroup(
        {
          accountGroupId,
          source: { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 },
          accounts: derivedAccounts,
          createdAt,
        },
        { selectAsCurrent: true },
      );
      await this.commitKeyringUpdate(commit, addition.update, [creation.update]);
      return { status: "added", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  async addMnemonicAndMoveAccount(params: AddMnemonicAndMoveAccountInput): Promise<KeySourceAdded> {
    const mnemonic = parseBip39Mnemonic(params.mnemonic);
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const group = this.#accounts.getGroupForAccount(params.accountId);
      if (!group) throw new AccountNotFoundError(params.accountId);
      const derivedAccounts = this.deriveFirstGroupAccounts(mnemonic);
      this.assertGroupAccountsAreDerived(group, derivedAccounts);
      const existingSource = this.#keyring.findMnemonicSource(mnemonic);
      if (existingSource) return this.getCompletedMnemonicMove(group, existingSource.keySourceId);
      if (group.source.type !== "private-key") throw new WalletAccountMoveConflictError(group.accounts[0].accountId);
      const addition = this.#keyring.prepareAddBip39Source({
        ...params,
        mnemonic,
        createdAt: this.#time.now(),
        removePrivateKeySourceId: group.source.keySourceId,
      });
      const move = this.#accounts.prepareMoveGroup(
        group.accountGroupId,
        { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 },
        derivedAccounts,
        { selectAsCurrent: true },
      );
      await this.commitKeyringUpdate(commit, addition.update, [move.update]);
      return { keySourceId: addition.keySourceId, accountGroupId: group.accountGroupId };
    });
  }

  async importPrivateKey(params: PrivateKeySourceInput): Promise<ImportPrivateKeySourceResult> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const createdAt = this.#time.now();
      const addition = this.#keyring.prepareAddPrivateKeySource({ ...params, createdAt });
      const existingGroup = this.#accounts.getGroupForAccount(addition.accountId);
      if (existingGroup) return { status: "duplicate", accountGroup: existingGroup };
      const accountGroupId = crypto.randomUUID();
      const creation = this.#accounts.prepareAddGroup(
        {
          accountGroupId,
          source: { type: "private-key", keySourceId: addition.keySourceId },
          accounts: [{ accountId: addition.accountId }],
          createdAt,
        },
        { selectAsCurrent: true },
      );
      await this.commitKeyringUpdate(commit, addition.update, [creation.update]);
      return { status: "added", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  async removeKeySource(params: { keySourceId: KeySourceId }): Promise<readonly AccountId[]> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      if (!this.#keyring.getKeySource(params.keySourceId)) throw new KeySourceNotFoundError(params.keySourceId);
      if (this.#keyring.listKeySources().length === 1) throw new WalletLastKeySourceRemovalError();
      const removal = this.#accounts.prepareRemoveSourceGroups(params.keySourceId);
      const permissionUpdate = this.#permissions.prepareRemoveAccountReferences(removal.removedAccountIds);
      const keyringUpdate = this.#keyring.prepareRemoveKeySource(params.keySourceId);
      await this.commitKeyringUpdate(commit, keyringUpdate, [removal.update, permissionUpdate]);
      this.#approvals.cancelByAccounts(removal.removedAccountIds);
      this.#dappConnections.refreshAccountsForOpenConnections();
      return removal.removedAccountIds;
    });
  }

  async exportMnemonic(params: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string } | null> {
    return this.#mutations.run(async () => {
      this.assertUnlocked();
      const source = this.#keyring.getKeySource(params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (source.type !== "bip39") throw new Error("Mnemonic export requires a BIP39 source.");
      if (!(await this.#keyring.verifyPassword(params.password))) return null;
      return { mnemonic: this.#keyring.exportMnemonic(params.keySourceId) };
    });
  }

  async exportPrivateKey(params: { accountId: AccountId; password: string }): Promise<{ privateKey: string } | null> {
    return this.#mutations.run(async () => {
      this.assertUnlocked();
      if (!this.#accounts.getAccount(params.accountId)) throw new AccountNotFoundError(params.accountId);
      if (!(await this.#keyring.verifyPassword(params.password))) return null;
      return { privateKey: this.#accountKeys.exportPrivateKey(params.accountId) };
    });
  }

  async createHdAccountGroup(params: { keySourceId: KeySourceId }): Promise<HdAccountGroupCreationResult> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const { accountIndex, accounts } = this.deriveNextGroupAccounts(params.keySourceId);
      const candidate = this.findMoveCandidate(accounts);
      if (candidate) return { status: "move-available", ...candidate };
      const creation = this.#accounts.prepareAddGroup({
        accountGroupId: crypto.randomUUID(),
        source: { type: "bip39", keySourceId: params.keySourceId, accountIndex },
        accounts,
        createdAt: this.#time.now(),
      });
      await commitUpdates(commit, [creation.update]);
      return { status: "created", accountGroup: creation.accountGroup };
    });
  }

  async movePrivateKeyAccount({ accountId, keySourceId }: MovePrivateKeyAccountInput): Promise<AccountGroup> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const group = this.#accounts.getGroupForAccount(accountId);
      if (!group) throw new AccountNotFoundError(accountId);
      if (group.source.type === "bip39" && group.source.keySourceId === keySourceId) return group;
      if (group.source.type !== "private-key") throw new WalletAccountMoveConflictError(group.accounts[0].accountId);
      const { accountIndex, accounts } = this.deriveNextGroupAccounts(keySourceId);
      this.assertGroupAccountsAreDerived(group, accounts);
      const move = this.#accounts.prepareMoveGroup(
        group.accountGroupId,
        { type: "bip39", keySourceId, accountIndex },
        accounts,
      );
      const keyringUpdate = this.#keyring.prepareRemoveKeySource(group.source.keySourceId);
      await this.commitKeyringUpdate(commit, keyringUpdate, [move.update]);
      return move.accountGroup;
    });
  }

  async setAccountGroupHidden(params: {
    accountGroupId: AccountGroupId;
    hidden: boolean;
  }): Promise<SetAccountGroupHiddenResult> {
    return this.#mutations.run(async (commit) => {
      const { accountGroup, replacementGroup, update } = this.#accounts.prepareSetGroupHidden(
        params.accountGroupId,
        params.hidden,
      );
      const result = { accountGroup, replacementGroup };
      if (!update) return result;
      const accountIds = accountGroup.accounts.map((account) => account.accountId);
      const permissionUpdate = params.hidden ? this.#permissions.prepareRemoveAccountReferences(accountIds) : null;
      await commitUpdates(commit, [update, permissionUpdate]);
      if (params.hidden) this.#approvals.cancelByAccounts(accountIds);
      this.#dappConnections.refreshAccountsForOpenConnections();
      return result;
    });
  }

  private async initializeBip39Wallet(
    params: CreateFromMnemonicInput,
    backupStatus: BackupStatus,
  ): Promise<WalletInitializationResult> {
    const mnemonic = parseBip39Mnemonic(params.mnemonic);
    return this.#mutations.run(async (commit) => {
      if (this.#keyring.getSoftwareKeyStatus() !== "uninitialized") return { status: "already-initialized" };
      const derivedAccounts = this.deriveFirstGroupAccounts(mnemonic);
      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareInitializeBip39Source({
        ...params,
        mnemonic,
        backupStatus,
        createdAt,
      });
      const accountGroupId = crypto.randomUUID();
      const creation = this.#accounts.prepareAddGroup({
        accountGroupId,
        source: { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 },
        accounts: derivedAccounts,
        createdAt,
      });
      await this.commitKeyringUpdate(commit, addition.update, [creation.update]);
      this.startUnlockedSession();
      return { status: "initialized", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  private startUnlockedSession(): void {
    this.#autoLock.start(() => {
      void this.#mutations.run(async () => this.lockIfExpired());
    });
    this.#dappConnections.refreshAccountsForOpenConnections();
    this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
  }

  private deriveFirstGroupAccounts(mnemonic: string): AccountGroupRecord["accounts"] {
    return this.#keyring.deriveBip39AccountIds({ mnemonic, namespaces: this.#namespaces, accountIndex: 0 });
  }

  private deriveNextGroupAccounts(
    keySourceId: KeySourceId,
  ): Readonly<{ accountIndex: number; accounts: AccountGroupRecord["accounts"] }> {
    const source = this.#keyring.getKeySource(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);
    if (source.type !== "bip39") throw new Error("HD account creation requires a BIP39 source.");
    const accountIndex = this.#accounts.nextAccountIndex(keySourceId);
    const accounts = this.#keyring.deriveHdAccountIds({ keySourceId, namespaces: this.#namespaces, accountIndex });
    return { accountIndex, accounts };
  }

  private findMoveCandidate(
    derivedIds: readonly { accountId: AccountId }[],
  ): Readonly<{ accountGroup: AccountGroup; accountId: AccountId }> | null {
    let candidate: Readonly<{ accountGroup: AccountGroup; accountId: AccountId }> | null = null;
    for (const { accountId } of derivedIds) {
      const group = this.#accounts.getGroupForAccount(accountId);
      if (!group) continue;
      if (
        group.source.type !== "private-key" ||
        (candidate !== null && candidate.accountGroup.accountGroupId !== group.accountGroupId)
      ) {
        throw new Error("Derived identities already belong to incompatible account groups.");
      }
      candidate = { accountGroup: group, accountId };
    }
    return candidate;
  }

  private assertGroupAccountsAreDerived(group: AccountGroup, derivedIds: readonly { accountId: AccountId }[]): void {
    for (const account of group.accounts) {
      if (!derivedIds.some((derived) => derived.accountId === account.accountId))
        throw new WalletAccountMoveConflictError(account.accountId);
    }
  }

  private async commitKeyringUpdate(
    commit: PersistenceWriter["commit"],
    update: PreparedKeyringUpdate,
    others: readonly (PreparedUpdate | null)[] = [],
  ): Promise<void> {
    try {
      await commitUpdates(commit, [update, ...others]);
    } finally {
      update.discard();
    }
  }

  private getCompletedMnemonicMove(group: AccountGroup, keySourceId: KeySourceId): KeySourceAdded {
    if (group.source.type !== "bip39" || group.source.keySourceId !== keySourceId || group.source.accountIndex !== 0) {
      throw new WalletAccountMoveConflictError(group.accounts[0].accountId);
    }
    return { keySourceId, accountGroupId: group.accountGroupId };
  }

  private assertUnlocked(): void {
    this.lockIfExpired();
    if (this.#keyring.getSoftwareKeyStatus() !== "unlocked") throw new WalletLockedError();
  }

  private lockIfExpired(): void {
    if (this.#autoLock.isExpired()) this.lockSession();
  }

  /** Runs inside the mutation queue, after any in-flight commit has settled. */
  private lockSession(): void {
    if (this.#keyring.getSoftwareKeyStatus() !== "unlocked") return;
    this.#autoLock.stop();
    this.#keyring.lock();
    this.#dappConnections.refreshAccountsForOpenConnections();
    this.#approvals.cancelAll();
    this.#publishStatusChanged({ type: "walletStatusChanged", status: "locked" });
  }
}
