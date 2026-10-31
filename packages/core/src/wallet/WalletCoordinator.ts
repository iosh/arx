import { type Accounts, type AccountUpdate, accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountAlreadyExistsError, AccountNotFoundError } from "../accounts/errors.js";
import type { AccountRecord } from "../accounts/persistence.js";
import type { Account, AccountsChanged } from "../accounts/types.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import { importBip39KeySourceSecret } from "../keyring/bip39.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError, KeySourceTypeMismatchError } from "../keyring/errors.js";
import type { Keyring, KeyringUpdate } from "../keyring/Keyring.js";
import type { HdKeyringRecord } from "../keyring/persistence.js";
import type { PrivateKeySourceSecret } from "../keyring/secrets.js";
import type { BackupStatus, HdKeyringId, KeyringChanged, KeySourceId } from "../keyring/types.js";
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
  AddHdKeyringInput,
  AddMnemonicAndMoveAccountInput,
  AddMnemonicSourceInput,
  AddMnemonicSourceResult,
  Bip39SourceAdded,
  Bip39WalletInitializationResult,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  HdAccountCreationResult,
  ImportPrivateKeySourceResult,
  MovePrivateKeyAccountInput,
  PrivateKeySourceInput,
  PrivateKeyWalletInitializationResult,
  RestoreFromMnemonicInput,
  SetAccountHiddenResult,
  WalletStatus,
  WalletStatusChanged,
} from "./Wallet.js";

type WalletCoordinatorOptions = Readonly<{
  mutations: CoreMutationQueue;
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
    const secret: PrivateKeySourceSecret = { keySourceId, type: "private-key", privateKey: params.privateKey };
    return this.#mutations.run(async (commit) => {
      if (this.#keyring.getSoftwareKeyStatus() !== "uninitialized") return { status: "already-initialized" };
      const accountId = this.#keyring.accountIdFromPrivateKey({
        namespace: params.namespace,
        privateKey: secret.privateKey,
      });
      const createdAt = this.#time.now();
      const accountsUpdate = this.#accounts.prepareAddAccount({
        accountId,
        origin: { type: "private-key", keySourceId },
        createdAt,
      });
      const keyringUpdate = await this.#keyring.prepareInitializePrivateKeySource({
        secret,
        namespace: params.namespace,
        createdAt,
        password: params.password,
      });

      await commit([...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);
      this.activateInitializedWallet(keyringUpdate, accountsUpdate);
      return { status: "initialized", keySourceId, accountId };
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

      const accountId = await this.#keyring.deriveBip39AccountId({
        namespace: params.namespace,
        source,
        derivationIndex: 0,
      });
      this.assertUnlocked();
      const existingAccount = this.#accounts.getAccount(accountId);
      if (existingAccount?.origin.type === "private-key") {
        return { status: "move-available", account: existingAccount };
      }
      if (existingAccount) throw new AccountAlreadyExistsError(accountId);

      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareAddBip39Source({
        secret: source,
        name: params.name,
        backupStatus: params.backupStatus,
        namespace: params.namespace,
        createdAt,
      });
      const { keySourceId, hdKeyringId } = addition;
      const accountsUpdate = this.#accounts.prepareAddAccount(
        { accountId, origin: { type: "hd", hdKeyringId, derivationIndex: 0 }, createdAt },
        { selectAsCurrent: true },
      );
      await this.saveKeyringAndAccounts(commit, addition, accountsUpdate);
      return { status: "added", keySourceId, hdKeyringId, accountId };
    });
  }

  async addMnemonicAndMoveAccount(params: AddMnemonicAndMoveAccountInput): Promise<Bip39SourceAdded> {
    const source = importBip39KeySourceSecret({ keySourceId: crypto.randomUUID(), mnemonic: params.mnemonic });
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const accountId = await this.#keyring.deriveBip39AccountId({
        namespace: params.namespace,
        source,
        derivationIndex: 0,
      });
      this.assertUnlocked();
      if (accountId !== params.accountId) throw new WalletAccountKeyMismatchError(params.accountId);
      const account = this.#accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      const existingSource = this.#keyring.findMnemonicSource(source.mnemonic);
      if (existingSource) return this.getCompletedMnemonicMove(account, existingSource.keySourceId, params.namespace);
      if (account.origin.type !== "private-key") throw new WalletAccountKeyMismatchError(accountId);

      const privateKeySourceId = account.origin.keySourceId;
      this.assertPrivateKeyControlsAccount(privateKeySourceId, accountId);
      const addition = await this.#keyring.prepareAddBip39Source({
        secret: source,
        name: params.name,
        backupStatus: params.backupStatus,
        namespace: params.namespace,
        createdAt: this.#time.now(),
        removePrivateKeySourceId: privateKeySourceId,
      });
      const { keySourceId, hdKeyringId } = addition;
      const accountsUpdate = this.#accounts.prepareAssignHdOrigin(
        accountId,
        { type: "hd", hdKeyringId, derivationIndex: 0 },
        { selectAsCurrent: true },
      );
      await this.saveKeyringAndAccounts(commit, addition, accountsUpdate);
      return { keySourceId, hdKeyringId, accountId };
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
      const existing = this.#accounts.getAccount(accountId);
      if (existing) return { status: "duplicate", account: existing };
      const createdAt = this.#time.now();
      const accountsUpdate = this.#accounts.prepareAddAccount(
        { accountId, origin: { type: "private-key", keySourceId }, createdAt },
        { selectAsCurrent: true },
      );
      const keyringUpdate = await this.#keyring.prepareAddPrivateKeySource({
        secret,
        namespace: params.namespace,
        createdAt,
      });
      await this.saveKeyringAndAccounts(commit, keyringUpdate, accountsUpdate);
      return { status: "added", keySourceId, accountId };
    });
  }

  async removeKeySource(params: { keySourceId: KeySourceId }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const source = this.#keyring.getKeySource(params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (this.#keyring.listKeySources().length === 1) throw new WalletLastKeySourceRemovalError();
      const hdKeyringIds = this.#keyring.listHdKeyringsByKeySourceIds([params.keySourceId]).map((hd) => hd.hdKeyringId);
      const accountsUpdate =
        source.type === "bip39"
          ? this.#accounts.prepareRemoveHdAccounts(hdKeyringIds)
          : this.#accounts.prepareRemovePrivateKeyAccounts([params.keySourceId]);
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

  async exportPrivateKey(params: {
    keySourceId: KeySourceId;
    password: string;
  }): Promise<{ privateKey: string } | null> {
    return await this.#mutations.run(async () => {
      this.assertUnlocked();
      const source = this.#keyring.requireKeySourceSecret(params.keySourceId);
      if (source.type !== "private-key") {
        throw new KeySourceTypeMismatchError({
          keySourceId: params.keySourceId,
          expectedType: "private-key",
          actualType: source.type,
        });
      }

      if (!(await this.verifyCurrentPassword(params.password))) return null;

      return { privateKey: source.privateKey };
    });
  }

  async addHdKeyring(params: AddHdKeyringInput): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }> {
    const hdKeyringId = crypto.randomUUID();
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const createdAt = this.#time.now();
      const hdKeyring: HdKeyringRecord = {
        hdKeyringId,
        keySourceId: params.keySourceId,
        namespace: params.namespace,
        nextDerivationIndex: 1,
        createdAt,
      };
      const keyringUpdate = this.#keyring.prepareAddHdKeyring(hdKeyring);
      const accountId = await this.#keyring.deriveHdAccountId({ hdKeyring, derivationIndex: 0 });
      const accountsUpdate = this.#accounts.prepareAddAccount({
        accountId,
        origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
        createdAt,
      });
      await this.saveKeyringAndAccounts(commit, keyringUpdate, accountsUpdate);
      return { hdKeyringId, accountId };
    });
  }

  async createHdAccount(params: { hdKeyringId: HdKeyringId }): Promise<HdAccountCreationResult> {
    return await this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const hdKeyring = this.#keyring.getHdKeyring(params.hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(params.hdKeyringId);

      const accountId = await this.deriveNextHdAccountId(hdKeyring);
      const existing = this.#accounts.getAccount(accountId);
      if (existing?.origin.type === "private-key") {
        return { status: "move-available", account: existing };
      }
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: {
          type: "hd",
          hdKeyringId: params.hdKeyringId,
          derivationIndex: hdKeyring.nextDerivationIndex,
        },
        createdAt: this.#time.now(),
      };
      const accountsUpdate = this.#accounts.prepareAddAccount(account);
      const keyringUpdate = this.#keyring.prepareAdvanceHdKeyring(hdKeyring);

      await this.saveKeyringAndAccounts(commit, keyringUpdate, accountsUpdate);

      return { status: "created", account: accountsUpdate.account };
    });
  }

  async movePrivateKeyAccount({ accountId, hdKeyringId }: MovePrivateKeyAccountInput): Promise<Account> {
    return this.#mutations.run(async (commit) => {
      this.assertUnlocked();
      const hdKeyring = this.#keyring.getHdKeyring(hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);
      const account = this.#accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);
      if (account.origin.type === "hd" && account.origin.hdKeyringId === hdKeyringId) return account;
      if (account.origin.type !== "private-key") throw new WalletAccountKeyMismatchError(accountId);

      const nextAccountId = await this.deriveNextHdAccountId(hdKeyring);
      if (nextAccountId !== accountId) throw new WalletAccountKeyMismatchError(accountId);
      const privateKeySourceId = account.origin.keySourceId;
      this.assertPrivateKeyControlsAccount(privateKeySourceId, accountId);
      const hdKeyringUpdate = this.#keyring.prepareAdvanceHdKeyring(hdKeyring);
      const accountsUpdate = this.#accounts.prepareAssignHdOrigin(accountId, {
        type: "hd",
        hdKeyringId,
        derivationIndex: hdKeyring.nextDerivationIndex,
      });
      const keySourceUpdate = await this.#keyring.prepareRemoveKeySource(privateKeySourceId);
      this.assertUnlocked();

      await commit([
        ...keySourceUpdate.persistenceChanges,
        ...hdKeyringUpdate.persistenceChanges,
        ...accountsUpdate.persistenceChanges,
      ]);
      hdKeyringUpdate.activate();
      keySourceUpdate.activate();
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.lockIfExpired();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      return accountsUpdate.account;
    });
  }

  async removeHdKeyring(params: { hdKeyringId: HdKeyringId }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const keyringUpdate = this.#keyring.prepareRemoveHdKeyring(params.hdKeyringId);
      const accountsUpdate = this.#accounts.prepareRemoveHdAccounts([params.hdKeyringId]);
      const permissionsUpdate = this.#permissions.prepareRemoveAccountReferences(
        accountsUpdate?.removedAccountIds ?? [],
      );

      await commit([
        ...keyringUpdate.persistenceChanges,
        ...(accountsUpdate?.persistenceChanges ?? []),
        ...(permissionsUpdate?.persistenceChanges ?? []),
      ]);

      keyringUpdate.activate();
      if (accountsUpdate) this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      this.#dappConnections.refreshAccountsForOpenConnections();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      if (accountsUpdate) this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
    });
  }

  async setAccountHidden(params: { accountId: AccountId; hidden: boolean }): Promise<SetAccountHiddenResult> {
    return this.#mutations.run(async (commit) => {
      const accountsUpdate = this.#accounts.prepareSetAccountHidden(params.accountId, params.hidden);
      const result = { account: accountsUpdate.account, replacementAccount: accountsUpdate.replacementAccount };
      if (accountsUpdate.persistenceChanges.length === 0) return result;

      const permissionsUpdate = params.hidden
        ? this.#permissions.prepareRemoveAccountReferences([params.accountId])
        : null;

      await commit([...accountsUpdate.persistenceChanges, ...(permissionsUpdate?.persistenceChanges ?? [])]);

      this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      if (params.hidden) this.#approvals.cancelByAccount(params.accountId);
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
      const accountId = await this.#keyring.deriveBip39AccountId({
        namespace: params.namespace,
        source,
        derivationIndex: 0,
      });
      const createdAt = this.#time.now();
      const addition = await this.#keyring.prepareInitializeBip39Source({
        secret: source,
        name: params.name,
        backupStatus,
        namespace: params.namespace,
        createdAt,
        password: params.password,
      });
      const { keySourceId, hdKeyringId } = addition;
      const accountsUpdate = this.#accounts.prepareAddAccount({
        accountId,
        origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
        createdAt,
      });
      await commit([...addition.persistenceChanges, ...accountsUpdate.persistenceChanges]);
      this.activateInitializedWallet(addition, accountsUpdate);
      return { status: "initialized", keySourceId, hdKeyringId, accountId };
    });
  }

  private activateInitializedWallet(keyringUpdate: KeyringUpdate, accountsUpdate: AccountUpdate): void {
    keyringUpdate.activate();
    this.#accounts.applyCommittedUpdate(accountsUpdate);
    this.startAutoLock();
    this.#dappConnections.refreshAccountsForOpenConnections();
    this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
    this.#publishKeyringChanged({ type: "keyringChanged" });
    this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
  }

  private async deriveNextHdAccountId(hdKeyring: HdKeyringRecord): Promise<AccountId> {
    const accountId = await this.#keyring.deriveHdAccountId({
      hdKeyring,
      derivationIndex: hdKeyring.nextDerivationIndex,
    });
    this.assertUnlocked();
    return accountId;
  }

  private async saveKeyringAndAccounts(
    commit: PersistenceWriter["commit"],
    keyringUpdate: KeyringUpdate,
    accountsUpdate: AccountUpdate,
  ): Promise<void> {
    this.assertUnlocked();
    await commit([...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);
    keyringUpdate.activate();
    this.#accounts.applyCommittedUpdate(accountsUpdate);
    this.lockIfExpired();
    this.#publishKeyringChanged({ type: "keyringChanged" });
    this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
  }

  private getCompletedMnemonicMove(account: Account, keySourceId: KeySourceId, namespace: Namespace): Bip39SourceAdded {
    if (account.origin.type !== "hd" || account.origin.derivationIndex !== 0) {
      throw new WalletAccountKeyMismatchError(account.accountId);
    }
    const hdKeyring = this.#keyring.getHdKeyring(account.origin.hdKeyringId);
    if (!hdKeyring || hdKeyring.keySourceId !== keySourceId || hdKeyring.namespace !== namespace) {
      throw new WalletAccountKeyMismatchError(account.accountId);
    }
    return { keySourceId, hdKeyringId: hdKeyring.hdKeyringId, accountId: account.accountId };
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
