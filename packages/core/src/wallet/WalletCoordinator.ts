import { type AccountGroupUpdate, type Accounts, accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountGroupId } from "../accounts/accountGroupId.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountAlreadyExistsError, AccountNotFoundError } from "../accounts/errors.js";
import type { AccountMemberRecord } from "../accounts/persistence.js";
import type { AccountGroup, AccountsChanged } from "../accounts/types.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import { importBip39KeySourceSecret } from "../keyring/bip39.js";
import { KeySourceNotFoundError, KeySourceTypeMismatchError } from "../keyring/errors.js";
import type { Keyring, KeyringUpdate } from "../keyring/Keyring.js";
import type { HdKeyringRecord } from "../keyring/persistence.js";
import type { Bip39KeySourceSecret, PrivateKeySourceSecret } from "../keyring/secrets.js";
import type { BackupStatus, KeyringChanged, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import { type Permissions, type PermissionsChanged, permissionsChangedFromUpdate } from "../permissions/Permissions.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { AUTO_LOCK_SETTING_KEY, settingWrites } from "../settings/persistence.js";
import {
  type AutoLockController,
  assertAutoLockDuration,
  DEFAULT_AUTO_LOCK_DURATION_MS,
} from "./AutoLockController.js";
import { WalletAccountKeyMismatchError, WalletLastKeySourceRemovalError, WalletLockedError } from "./errors.js";
import type {
  AddMnemonicAndMoveAccountInput,
  AddMnemonicSourceInput,
  AddMnemonicSourceResult,
  Bip39SourceAdded,
  Bip39WalletInitializationResult,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  HdAccountGroupCreationResult,
  ImportPrivateKeySourceResult,
  MovePrivateKeyAccountInput,
  PrivateKeySourceInput,
  PrivateKeyWalletInitializationResult,
  RestoreFromMnemonicInput,
  SetAccountGroupHiddenResult,
  WalletStatus,
  WalletStatusChanged,
} from "./Wallet.js";

type WalletCoordinatorOptions = Readonly<{
  mutations: CoreMutationQueue;
  namespaces: readonly Namespace[];
  time: CoreTime;
  keyring: Keyring;
  accounts: Accounts;
  permissions: Pick<Permissions, "prepareRemoveAccountReferences" | "applyCommittedUpdate">;
  approvals: Pick<Approvals, "cancelByAccount" | "cancelAll">;
  dappConnections: Pick<DappConnections, "refreshAccountsForOpenConnections">;
  autoLock: AutoLockController;
  publishStatusChanged(change: WalletStatusChanged): void;
  publishKeyringChanged(change: KeyringChanged): void;
  publishAccountsChanged(change: AccountsChanged): void;
  publishPermissionsChanged(change: PermissionsChanged): void;
}>;

/** Coordinates wallet session and identity mutations across their owning modules. */
export class WalletCoordinator {
  readonly #mutations: CoreMutationQueue;
  readonly #namespaces: readonly Namespace[];
  readonly #time: CoreTime;
  readonly #keyring: Keyring;
  readonly #accounts: Accounts;
  readonly #permissions: WalletCoordinatorOptions["permissions"];
  readonly #approvals: WalletCoordinatorOptions["approvals"];
  readonly #dappConnections: WalletCoordinatorOptions["dappConnections"];
  readonly #autoLock: AutoLockController;
  readonly #publishStatusChanged: WalletCoordinatorOptions["publishStatusChanged"];
  readonly #publishKeyringChanged: WalletCoordinatorOptions["publishKeyringChanged"];
  readonly #publishAccountsChanged: WalletCoordinatorOptions["publishAccountsChanged"];
  readonly #publishPermissionsChanged: WalletCoordinatorOptions["publishPermissionsChanged"];

  constructor(options: WalletCoordinatorOptions) {
    this.#mutations = options.mutations;
    this.#namespaces = options.namespaces;
    this.#time = options.time;
    this.#keyring = options.keyring;
    this.#accounts = options.accounts;
    this.#permissions = options.permissions;
    this.#approvals = options.approvals;
    this.#dappConnections = options.dappConnections;
    this.#autoLock = options.autoLock;
    this.#publishStatusChanged = options.publishStatusChanged;
    this.#publishKeyringChanged = options.publishKeyringChanged;
    this.#publishAccountsChanged = options.publishAccountsChanged;
    this.#publishPermissionsChanged = options.publishPermissionsChanged;
  }

  getStatus(): WalletStatus {
    const status = this.#keyring.getSoftwareKeyStatus();
    return status === "unlocked" && this.#autoLock.isExpired() ? "locked" : status;
  }

  notifyUserActivity(): void {
    this.#autoLock.recordActivity();
  }

  createFromMnemonic(params: CreateFromMnemonicInput): Promise<Bip39WalletInitializationResult> {
    return this.initializeBip39Wallet(params, "pending");
  }

  restoreFromMnemonic(params: RestoreFromMnemonicInput): Promise<Bip39WalletInitializationResult> {
    return this.initializeBip39Wallet(params, "confirmed");
  }

  async createFromPrivateKey(params: CreateFromPrivateKeyInput): Promise<PrivateKeyWalletInitializationResult> {
    const keySourceId = crypto.randomUUID();
    const accountGroupId = crypto.randomUUID();
    const secret: PrivateKeySourceSecret = { keySourceId, type: "private-key", privateKey: params.privateKey };
    return this.#mutations.run(async (commit) => {
      if (this.#keyring.getSoftwareKeyStatus() !== "uninitialized") return { status: "already-initialized" };
      const accountId = this.#keyring.accountIdFromPrivateKey({
        namespace: params.namespace,
        privateKey: secret.privateKey,
      });
      const createdAt = this.#time.now();
      const accountsUpdate = this.#accounts.prepareAddGroup(
        { accountGroupId, source: { type: "private-key", keySourceId }, createdAt },
        [{ accountId, origin: { type: "private-key", keySourceId } }],
      );
      const keyringUpdate = await this.#keyring.prepareInitializePrivateKeySource({
        secret,
        namespace: params.namespace,
        createdAt,
        password: params.password,
      });
      await commit([...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);
      this.activateInitializedWallet(keyringUpdate, accountsUpdate);
      return { status: "initialized", keySourceId, accountGroupId };
    });
  }

  async unlock(password: string): Promise<boolean> {
    return this.#mutations.run(async () => {
      this.lockIfExpired();
      if (this.#keyring.getSoftwareKeyStatus() === "unlocked") return true;
      const unlocked = await this.#keyring.prepareUnlock(password);
      if (unlocked === null) return false;

      unlocked.activate();
      this.startAutoLock();
      this.#dappConnections.refreshAccountsForOpenConnections();
      this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
      return true;
    });
  }

  async lock(): Promise<void> {
    await this.#mutations.run(async () => {
      this.lockSession();
    });
  }

  async changePassword(params: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const update = await this.#keyring.prepareChangePassword(params);
      this.assertUnlocked();
      await commit(update.persistenceChanges);
      update.activate();
      this.lockIfExpired();
    });
  }

  async setAutoLockDuration(durationMs: number): Promise<void> {
    assertAutoLockDuration(durationMs);

    await this.#mutations.run(async (commit) => {
      if (this.#autoLock.getDuration() === durationMs) return;

      const change =
        durationMs === DEFAULT_AUTO_LOCK_DURATION_MS
          ? settingWrites.remove(AUTO_LOCK_SETTING_KEY)
          : settingWrites.put({
              key: AUTO_LOCK_SETTING_KEY,
              durationMs,
            });

      await commit([change]);

      this.#autoLock.applyDuration(durationMs);
      this.lockIfExpired();
    });
  }

  async addMnemonic(params: AddMnemonicSourceInput): Promise<AddMnemonicSourceResult> {
    const source = importBip39KeySourceSecret({ keySourceId: crypto.randomUUID(), mnemonic: params.mnemonic });
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const existingSource = this.#keyring.findMnemonicSource(source.mnemonic);
      if (existingSource) return { status: "duplicate", walletName: existingSource.name };
      const derivedIds = await this.deriveFirstAccountIds(source);
      this.assertUnlocked();
      const existingGroup = this.findAccountGroupToMove(derivedIds);
      if (existingGroup) return { status: "move-available", account: existingGroup };
      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareAddBip39Source({
        secret: source,
        name: params.name,
        backupStatus: params.backupStatus,
        namespaces: this.#namespaces,
        createdAt,
      });
      const accountGroupId = crypto.randomUUID();
      const accountsUpdate = this.#accounts.prepareAddGroup(
        { accountGroupId, source: { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 }, createdAt },
        this.buildFirstHdMembers(addition.hdKeyrings, derivedIds),
        { selectAsCurrent: true },
      );
      await this.commitKeyringAndAccounts(commit, addition, accountsUpdate);
      return { status: "added", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  async addMnemonicAndMoveAccount(params: AddMnemonicAndMoveAccountInput): Promise<Bip39SourceAdded> {
    const source = importBip39KeySourceSecret({ keySourceId: crypto.randomUUID(), mnemonic: params.mnemonic });
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const group = this.#accounts.getGroupForMember(params.accountId);
      if (!group) throw new AccountNotFoundError(params.accountId);
      const derivedIds = await this.deriveFirstAccountIds(source);
      this.assertUnlocked();
      this.assertGroupMembersAreDerived(group, derivedIds);
      const existingSource = this.#keyring.findMnemonicSource(source.mnemonic);
      if (existingSource) return this.getCompletedMnemonicMove(group, existingSource.keySourceId);
      if (group.source.type !== "private-key") throw new WalletAccountKeyMismatchError(group.members[0].accountId);
      const privateKeySourceId = group.source.keySourceId;
      for (const member of group.members) this.assertPrivateKeyControlsAccount(privateKeySourceId, member.accountId);
      const addition = await this.#keyring.prepareAddBip39Source({
        secret: source,
        name: params.name,
        backupStatus: params.backupStatus,
        namespaces: this.#namespaces,
        createdAt: this.#time.now(),
        removePrivateKeySourceId: privateKeySourceId,
      });
      const accountsUpdate = this.#accounts.prepareMoveGroup(
        group.accountGroupId,
        { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 },
        this.buildFirstHdMembers(addition.hdKeyrings, derivedIds),
        { selectAsCurrent: true },
      );
      await this.commitKeyringAndAccounts(commit, addition, accountsUpdate);
      return { keySourceId: addition.keySourceId, accountGroupId: group.accountGroupId };
    });
  }

  async importPrivateKey(params: PrivateKeySourceInput): Promise<ImportPrivateKeySourceResult> {
    const keySourceId = crypto.randomUUID();
    const secret: PrivateKeySourceSecret = { keySourceId, type: "private-key", privateKey: params.privateKey };
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const accountId = this.#keyring.accountIdFromPrivateKey({
        namespace: params.namespace,
        privateKey: secret.privateKey,
      });
      const existingGroup = this.#accounts.getGroupForMember(accountId);
      if (existingGroup) return { status: "duplicate", account: existingGroup };
      const createdAt = this.#time.now();
      const accountGroupId = crypto.randomUUID();
      const accountsUpdate = this.#accounts.prepareAddGroup(
        { accountGroupId, source: { type: "private-key", keySourceId }, createdAt },
        [{ accountId, origin: { type: "private-key", keySourceId } }],
        { selectAsCurrent: true },
      );
      const keyringUpdate = await this.#keyring.prepareAddPrivateKeySource({
        secret,
        namespace: params.namespace,
        createdAt,
      });
      await this.commitKeyringAndAccounts(commit, keyringUpdate, accountsUpdate);
      return { status: "added", keySourceId, accountGroupId };
    });
  }

  async removeKeySource(params: { keySourceId: KeySourceId }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const source = this.#keyring.getKeySource(params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (this.#keyring.listKeySources().length === 1) throw new WalletLastKeySourceRemovalError();
      const accountsUpdate = this.#accounts.prepareRemoveSourceGroups(params.keySourceId);
      const permissionsUpdate = this.#permissions.prepareRemoveAccountReferences(
        accountsUpdate?.removedAccountIds ?? [],
      );
      const keyringUpdate = await this.#keyring.prepareRemoveKeySource(params.keySourceId);
      this.assertUnlocked();

      await commit([
        ...keyringUpdate.persistenceChanges,
        ...(accountsUpdate?.persistenceChanges ?? []),
        ...(permissionsUpdate?.persistenceChanges ?? []),
      ]);
      keyringUpdate.activate();
      if (accountsUpdate) this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      for (const accountId of accountsUpdate?.removedAccountIds ?? []) this.#approvals.cancelByAccount(accountId);
      this.lockIfExpired();
      this.#dappConnections.refreshAccountsForOpenConnections();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      if (accountsUpdate) this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
    });
  }

  async exportMnemonic(params: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string } | null> {
    return await this.#mutations.run(async () => {
      this.assertUnlocked();
      const source = this.#keyring.requireKeySourceSecret(params.keySourceId);
      if (source.type !== "bip39") {
        throw new KeySourceTypeMismatchError({
          keySourceId: params.keySourceId,
          expectedType: "bip39",
          actualType: source.type,
        });
      }

      if (!(await this.verifyCurrentPassword(params.password))) return null;

      return { mnemonic: source.mnemonic };
    });
  }

  async exportPrivateKey(params: { accountId: AccountId; password: string }): Promise<{ privateKey: string } | null> {
    return this.#mutations.run(async () => {
      this.assertUnlocked();
      const member = this.#accounts.getMemberRecord(params.accountId);
      if (!member) throw new AccountNotFoundError(params.accountId);

      if (!(await this.verifyCurrentPassword(params.password))) return null;

      const privateKey = await this.#keyring.getPrivateKey(member.origin);
      this.assertUnlocked();
      return { privateKey };
    });
  }

  async createHdAccountGroup(params: { keySourceId: KeySourceId }): Promise<HdAccountGroupCreationResult> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const { accountIndex, members } = await this.deriveNextGroupMembers(params.keySourceId);
      const existingGroup = this.findAccountGroupToMove(members);
      if (existingGroup) return { status: "move-available", account: existingGroup };
      const accountsUpdate = this.#accounts.prepareAddGroup(
        {
          accountGroupId: crypto.randomUUID(),
          source: { type: "bip39", keySourceId: params.keySourceId, accountIndex },
          createdAt: this.#time.now(),
        },
        members,
      );
      this.assertUnlocked();
      await commit(accountsUpdate.persistenceChanges);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.lockIfExpired();
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      return { status: "created", account: accountsUpdate.account };
    });
  }

  async movePrivateKeyAccount({ accountId, keySourceId }: MovePrivateKeyAccountInput): Promise<AccountGroup> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const group = this.#accounts.getGroupForMember(accountId);
      if (!group) throw new AccountNotFoundError(accountId);
      if (group.source.type === "bip39" && group.source.keySourceId === keySourceId) return group;
      if (group.source.type !== "private-key") throw new WalletAccountKeyMismatchError(group.members[0].accountId);
      const { accountIndex, members } = await this.deriveNextGroupMembers(keySourceId);
      this.assertGroupMembersAreDerived(group, members);
      for (const member of group.members)
        this.assertPrivateKeyControlsAccount(group.source.keySourceId, member.accountId);
      const accountsUpdate = this.#accounts.prepareMoveGroup(
        group.accountGroupId,
        { type: "bip39", keySourceId, accountIndex },
        members,
      );
      const keySourceUpdate = await this.#keyring.prepareRemoveKeySource(group.source.keySourceId);
      await this.commitKeyringAndAccounts(commit, keySourceUpdate, accountsUpdate);
      return accountsUpdate.account;
    });
  }

  async setAccountGroupHidden(params: {
    accountGroupId: AccountGroupId;
    hidden: boolean;
  }): Promise<SetAccountGroupHiddenResult> {
    return this.#mutations.run(async (commit) => {
      const accountsUpdate = this.#accounts.prepareSetGroupHidden(params.accountGroupId, params.hidden);
      const result = { account: accountsUpdate.account, replacementAccount: accountsUpdate.replacementAccount };
      if (accountsUpdate.persistenceChanges.length === 0) return result;

      const permissionsUpdate = params.hidden
        ? this.#permissions.prepareRemoveAccountReferences(
            accountsUpdate.account.members.map((member) => member.accountId),
          )
        : null;

      await commit([...accountsUpdate.persistenceChanges, ...(permissionsUpdate?.persistenceChanges ?? [])]);

      this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      if (params.hidden)
        for (const member of accountsUpdate.account.members) this.#approvals.cancelByAccount(member.accountId);
      this.#dappConnections.refreshAccountsForOpenConnections();
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
      return result;
    });
  }

  private async initializeBip39Wallet(
    params: CreateFromMnemonicInput,
    backupStatus: BackupStatus,
  ): Promise<Bip39WalletInitializationResult> {
    const source = importBip39KeySourceSecret({ keySourceId: crypto.randomUUID(), mnemonic: params.mnemonic });
    return this.#mutations.run(async (commit) => {
      if (this.#keyring.getSoftwareKeyStatus() !== "uninitialized") return { status: "already-initialized" };
      const derivedIds = await this.deriveFirstAccountIds(source);
      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareInitializeBip39Source({
        secret: source,
        name: params.name,
        backupStatus,
        namespaces: this.#namespaces,
        createdAt,
        password: params.password,
      });
      const accountGroupId = crypto.randomUUID();
      const accountsUpdate = this.#accounts.prepareAddGroup(
        { accountGroupId, source: { type: "bip39", keySourceId: addition.keySourceId, accountIndex: 0 }, createdAt },
        this.buildFirstHdMembers(addition.hdKeyrings, derivedIds),
      );
      await commit([...addition.persistenceChanges, ...accountsUpdate.persistenceChanges]);
      this.activateInitializedWallet(addition, accountsUpdate);
      return { status: "initialized", keySourceId: addition.keySourceId, accountGroupId };
    });
  }

  private activateInitializedWallet(keyringUpdate: KeyringUpdate, accountsUpdate: AccountGroupUpdate): void {
    keyringUpdate.activate();
    this.#accounts.applyCommittedUpdate(accountsUpdate);
    this.startAutoLock();
    this.#dappConnections.refreshAccountsForOpenConnections();
    this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
    this.#publishKeyringChanged({ type: "keyringChanged" });
    this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
  }

  private deriveFirstAccountIds(
    source: Bip39KeySourceSecret,
  ): Promise<readonly { accountId: AccountId; namespace: Namespace }[]> {
    return Promise.all(
      this.#namespaces.map(async (namespace) => ({
        namespace,
        accountId: await this.#keyring.deriveBip39AccountId({ namespace, source, derivationIndex: 0 }),
      })),
    );
  }

  private buildFirstHdMembers(
    hdKeyrings: readonly HdKeyringRecord[],
    derivedIds: readonly { accountId: AccountId; namespace: Namespace }[],
  ): readonly Omit<AccountMemberRecord, "accountGroupId">[] {
    const accountIdsByNamespace = new Map(derivedIds.map(({ namespace, accountId }) => [namespace, accountId]));
    return hdKeyrings.map((hdKeyring) => ({
      accountId: accountIdsByNamespace.get(hdKeyring.namespace) as AccountId,
      origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: 0 },
    }));
  }

  private async deriveNextGroupMembers(
    keySourceId: KeySourceId,
  ): Promise<{ accountIndex: number; members: readonly Omit<AccountMemberRecord, "accountGroupId">[] }> {
    const source = this.#keyring.getKeySource(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);
    if (source.type !== "bip39")
      throw new KeySourceTypeMismatchError({ keySourceId, expectedType: "bip39", actualType: source.type });
    const accountIndex = this.#accounts.nextAccountIndex(keySourceId);
    const members = await Promise.all(
      this.#keyring.listHdKeyringsByKeySourceIds([keySourceId]).map(
        async (hdKeyring): Promise<Omit<AccountMemberRecord, "accountGroupId">> => ({
          accountId: await this.#keyring.deriveHdAccountId({ hdKeyring, derivationIndex: accountIndex }),
          origin: { type: "hd", hdKeyringId: hdKeyring.hdKeyringId, derivationIndex: accountIndex },
        }),
      ),
    );
    this.assertUnlocked();
    return { accountIndex, members };
  }

  private findAccountGroupToMove(derivedIds: readonly { accountId: AccountId }[]): AccountGroup | null {
    let candidateGroup: AccountGroup | null = null;
    for (const { accountId } of derivedIds) {
      const existingGroup = this.#accounts.getGroupForMember(accountId);
      if (!existingGroup) continue;
      if (
        existingGroup.source.type !== "private-key" ||
        (candidateGroup !== null && candidateGroup.accountGroupId !== existingGroup.accountGroupId)
      )
        throw new AccountAlreadyExistsError(accountId);
      candidateGroup = existingGroup;
    }
    return candidateGroup;
  }

  private assertGroupMembersAreDerived(group: AccountGroup, derivedIds: readonly { accountId: AccountId }[]): void {
    for (const member of group.members) {
      if (!derivedIds.some((derived) => derived.accountId === member.accountId))
        throw new WalletAccountKeyMismatchError(member.accountId);
    }
  }

  private async commitKeyringAndAccounts(
    commit: PersistenceWriter["commit"],
    keyringUpdate: KeyringUpdate,
    accountsUpdate: AccountGroupUpdate,
  ): Promise<void> {
    this.assertUnlocked();
    await commit([...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);
    keyringUpdate.activate();
    this.#accounts.applyCommittedUpdate(accountsUpdate);
    this.lockIfExpired();
    this.#publishKeyringChanged({ type: "keyringChanged" });
    this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
  }

  private getCompletedMnemonicMove(group: AccountGroup, keySourceId: KeySourceId): Bip39SourceAdded {
    if (group.source.type !== "bip39" || group.source.keySourceId !== keySourceId || group.source.accountIndex !== 0)
      throw new WalletAccountKeyMismatchError(group.members[0].accountId);
    return { keySourceId, accountGroupId: group.accountGroupId };
  }

  private assertPrivateKeyControlsAccount(keySourceId: KeySourceId, accountId: AccountId): void {
    if (this.#keyring.accountIdFromPrivateKeySource(keySourceId) !== accountId) {
      throw new WalletAccountKeyMismatchError(accountId);
    }
  }

  private async verifyCurrentPassword(password: string): Promise<boolean> {
    const matches = await this.#keyring.verifyPassword(password);
    if (!matches) return false;
    this.assertUnlocked();
    return true;
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

  private startAutoLock(): void {
    this.#autoLock.start(() => {
      void this.#mutations.run(async () => this.lockIfExpired());
    });
  }
}
