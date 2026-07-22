import { type Accounts, accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountRecord } from "../accounts/persistence.js";
import type { AccountsChanged } from "../accounts/types.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import { deriveBip39Seed, importBip39KeySourceSecret } from "../keyring/bip39.js";
import {
  HdKeyringNotFoundError,
  KeyringDuplicateSourceError,
  KeySourceNotFoundError,
  KeySourceTypeMismatchError,
} from "../keyring/errors.js";
import type { Keyring } from "../keyring/Keyring.js";
import {
  type Bip39KeySourceSecret,
  createKeyringSecrets,
  decodeKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type KeyringSecrets,
  type PrivateKeySourceSecret,
} from "../keyring/secrets.js";
import type { BackupStatus, HdKeyringId, KeyringChanged, KeySourceId } from "../keyring/types.js";
import { type Permissions, type PermissionsChanged, permissionsChangedFromUpdate } from "../permissions/Permissions.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { AUTO_LOCK_SETTING_KEY, settingPersistenceType } from "../settings/persistence.js";
import { changeVaultPassword, createUnlockedVault, replaceVaultPlaintext, unlockVaultRecord } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import type { Vault } from "../vault/Vault.js";
import {
  type AutoLockController,
  assertAutoLockDuration,
  DEFAULT_AUTO_LOCK_DURATION_MS,
} from "./AutoLockController.js";
import {
  WalletAlreadyInitializedError,
  WalletLastKeySourceRemovalError,
  WalletLockedError,
  WalletUnlockFailedError,
} from "./errors.js";
import type {
  AddHdKeyringInput,
  Bip39SourceAdded,
  Bip39WalletCreated,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  MnemonicSourceInput,
  PrivateKeySourceAdded,
  PrivateKeySourceInput,
  PrivateKeyWalletCreated,
  RestoreFromMnemonicInput,
  WalletStatusChanged,
} from "./Wallet.js";

type WalletCoordinatorOptions = Readonly<{
  mutations: CoreMutationQueue;
  time: CoreTime;
  vault: Vault;
  keyring: Keyring;
  accounts: Accounts;
  permissions: Pick<Permissions, "prepareRemoveAccountReferences" | "applyCommittedUpdate">;
  approvals: Pick<Approvals, "cancelAll">;
  dappConnections: Pick<DappConnections, "refreshActiveConnectionStates">;
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
  readonly #vault: Vault;
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
    this.#vault = options.vault;
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

  createFromMnemonic(params: CreateFromMnemonicInput): Promise<Bip39WalletCreated> {
    return this.initializeBip39Wallet(params, "pending");
  }

  restoreFromMnemonic(params: RestoreFromMnemonicInput): Promise<Bip39WalletCreated> {
    return this.initializeBip39Wallet(params, "confirmed");
  }

  async createFromPrivateKey(params: CreateFromPrivateKeyInput): Promise<PrivateKeyWalletCreated> {
    const keySourceId = crypto.randomUUID();
    const source: PrivateKeySourceSecret = {
      keySourceId,
      type: "private-key",
      privateKey: params.privateKey,
    };

    return await this.#mutations.run(async (commit) => {
      if (this.#vault.getStatus() !== "uninitialized") throw new WalletAlreadyInitializedError();

      const accountId = this.#keyring.accountIdFromPrivateKey({
        namespace: params.namespace,
        privateKey: source.privateKey,
      });
      const createdAt = this.#time.now();
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: { type: "private-key", keySourceId },
        createdAt,
      };
      const keyringUpdate = this.#keyring.prepareAddPrivateKeySource({
        keySourceId,
        type: "private-key",
        namespace: params.namespace,
        createdAt,
      });
      const accountsUpdate = this.#accounts.prepareAddAccount(account);
      const secrets = createKeyringSecrets([source]);
      const unlocked = await createUnlockedVault({
        password: params.password,
        plaintext: encodeKeyringSecrets(secrets),
      });

      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
        ...keyringUpdate.persistenceChanges,
        ...accountsUpdate.persistenceChanges,
      ]);

      this.#vault.activate(unlocked);
      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#keyring.activateSecrets(secrets);
      this.startAutoLock();
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return { keySourceId, accountId };
    });
  }

  async unlock(password: string): Promise<void> {
    await this.#mutations.run(async () => {
      if (this.#vault.getStatus() === "unlocked") return;

      const draft = await unlockVaultRecord(this.#vault.requireRecord(), password);

      let secrets: KeyringSecrets;
      try {
        secrets = decodeKeyringSecrets(draft.plaintext);
      } catch (cause) {
        throw new WalletUnlockFailedError(cause);
      }

      this.#vault.activate(draft.unlocked);
      this.#keyring.activateSecrets(secrets);
      this.startAutoLock();
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
    });
  }

  async lock(): Promise<void> {
    await this.#mutations.run(async () => {
      if (this.#vault.getStatus() !== "unlocked") return;

      this.#autoLock.stop();
      this.#keyring.lock();
      this.#vault.lock();
      this.#dappConnections.refreshActiveConnectionStates();
      this.#approvals.cancelAll();
      this.#publishStatusChanged({ type: "walletStatusChanged", status: "locked" });
    });
  }

  async changePassword(params: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const draft = await changeVaultPassword({
        unlocked: this.#vault.requireUnlocked(),
        currentPassword: params.currentPassword,
        newPassword: params.newPassword,
      });

      await commit([persistenceChange.put(encryptedVaultPersistenceType, draft.record)]);

      this.#vault.activate(draft);
      this.#autoLock.recordActivity();
    });
  }

  async setAutoLockDuration(durationMs: number): Promise<void> {
    assertAutoLockDuration(durationMs);

    await this.#mutations.run(async (commit) => {
      if (this.#autoLock.getDuration() === durationMs) return;

      const change =
        durationMs === DEFAULT_AUTO_LOCK_DURATION_MS
          ? persistenceChange.remove(settingPersistenceType, AUTO_LOCK_SETTING_KEY)
          : persistenceChange.put(settingPersistenceType, {
              key: AUTO_LOCK_SETTING_KEY,
              durationMs,
            });

      await commit([change]);

      this.#autoLock.applyDuration(durationMs);
    });
  }

  addMnemonic(params: MnemonicSourceInput): Promise<Bip39SourceAdded> {
    return this.addBip39Source(params, "pending");
  }

  importMnemonic(params: MnemonicSourceInput): Promise<Bip39SourceAdded> {
    return this.addBip39Source(params, "confirmed");
  }

  async importPrivateKey(params: PrivateKeySourceInput): Promise<PrivateKeySourceAdded> {
    const keySourceId = crypto.randomUUID();
    const source: PrivateKeySourceSecret = {
      keySourceId,
      type: "private-key",
      privateKey: params.privateKey,
    };

    return await this.#mutations.run(async (commit) => {
      const secrets = this.requireKeyringSecrets();
      const unlocked = this.#vault.requireUnlocked();
      const accountId = this.#keyring.accountIdFromPrivateKey({
        namespace: params.namespace,
        privateKey: source.privateKey,
      });
      const existingAccount = this.#accounts.getAccountRecord(accountId);
      if (existingAccount?.origin.type === "private-key") {
        throw new KeyringDuplicateSourceError(existingAccount.origin.keySourceId);
      }

      const createdAt = this.#time.now();
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: { type: "private-key", keySourceId },
        createdAt,
      };
      const keyringUpdate = this.#keyring.prepareAddPrivateKeySource({
        keySourceId,
        type: "private-key",
        namespace: params.namespace,
        createdAt,
      });
      const accountsUpdate = this.#accounts.prepareAddAccount(account);
      const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
      const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));

      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
        ...keyringUpdate.persistenceChanges,
        ...accountsUpdate.persistenceChanges,
      ]);

      this.#vault.activate(nextUnlocked);
      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#keyring.activateSecrets(nextSecrets);
      this.#autoLock.recordActivity();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return { keySourceId, accountId };
    });
  }

  async removeKeySource(params: { keySourceId: KeySourceId }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const secrets = this.requireKeyringSecrets();
      const unlocked = this.#vault.requireUnlocked();
      const source = this.#keyring.getKeySource(params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (this.#keyring.listKeySources().length === 1) throw new WalletLastKeySourceRemovalError();

      const hdKeyringIds = this.#keyring
        .listHdKeyringsByKeySourceIds([params.keySourceId])
        .map((hdKeyring) => hdKeyring.hdKeyringId);
      const accountsUpdate =
        source.type === "bip39"
          ? this.#accounts.prepareRemoveHdAccounts(hdKeyringIds)
          : this.#accounts.prepareRemovePrivateKeyAccounts([params.keySourceId]);
      const permissionsUpdate = this.#permissions.prepareRemoveAccountReferences(
        accountsUpdate?.removedAccountIds ?? [],
      );
      const keyringUpdate = this.#keyring.prepareRemoveKeySource(params.keySourceId);
      const nextSecrets = createKeyringSecrets(
        secrets.keySources.filter((candidate) => candidate.keySourceId !== params.keySourceId),
      );
      const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));

      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
        ...keyringUpdate.persistenceChanges,
        ...(accountsUpdate?.persistenceChanges ?? []),
        ...(permissionsUpdate?.persistenceChanges ?? []),
      ]);

      this.#vault.activate(nextUnlocked);
      this.#keyring.applyCommittedUpdate(keyringUpdate);
      if (accountsUpdate) this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      this.#keyring.activateSecrets(nextSecrets);
      this.#autoLock.recordActivity();
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      if (accountsUpdate) this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
    });
  }

  async confirmMnemonicBackup(params: { keySourceId: KeySourceId }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const keyringUpdate = this.#keyring.prepareConfirmBackup(params.keySourceId);
      if (!keyringUpdate) return;

      await commit(keyringUpdate.persistenceChanges);

      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#publishKeyringChanged({ type: "keyringChanged" });
    });
  }

  async exportMnemonic(params: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string }> {
    return await this.#mutations.run(async () => {
      const source = findKeySourceSecret(this.requireKeyringSecrets(), params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (source.type !== "bip39") {
        throw new KeySourceTypeMismatchError({
          keySourceId: params.keySourceId,
          expectedType: "bip39",
          actualType: source.type,
        });
      }

      await this.verifyCurrentPassword(params.password);

      this.#autoLock.recordActivity();
      return { mnemonic: source.mnemonic };
    });
  }

  async exportPrivateKey(params: { keySourceId: KeySourceId; password: string }): Promise<{ privateKey: string }> {
    return await this.#mutations.run(async () => {
      const source = findKeySourceSecret(this.requireKeyringSecrets(), params.keySourceId);
      if (!source) throw new KeySourceNotFoundError(params.keySourceId);
      if (source.type !== "private-key") {
        throw new KeySourceTypeMismatchError({
          keySourceId: params.keySourceId,
          expectedType: "private-key",
          actualType: source.type,
        });
      }

      await this.verifyCurrentPassword(params.password);

      this.#autoLock.recordActivity();
      return { privateKey: source.privateKey };
    });
  }

  async addHdKeyring(params: AddHdKeyringInput): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }> {
    const hdKeyringId = crypto.randomUUID();

    return await this.#mutations.run(async (commit) => {
      const secrets = this.requireKeyringSecrets();
      const createdAt = this.#time.now();
      const keyringUpdate = this.#keyring.prepareAddHdKeyring({
        hdKeyringId,
        keySourceId: params.keySourceId,
        namespace: params.namespace,
        nextDerivationIndex: 1,
        createdAt,
      });
      const source = this.requireBip39Source(secrets, params.keySourceId);
      const seed = await deriveBip39Seed(source);
      const accountId = this.#keyring.deriveHdAccountId({
        namespace: params.namespace,
        seed,
        derivationIndex: 0,
      });
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
        createdAt,
      };
      const accountsUpdate = this.#accounts.prepareAddAccount(account);

      await commit([...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);

      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#autoLock.recordActivity();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return { hdKeyringId, accountId };
    });
  }

  async deriveHdAccount(params: { hdKeyringId: HdKeyringId }): Promise<AccountId> {
    return await this.#mutations.run(async (commit) => {
      const secrets = this.requireKeyringSecrets();
      const hdKeyring = this.#keyring.getHdKeyring(params.hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(params.hdKeyringId);

      const source = this.requireBip39Source(secrets, hdKeyring.keySourceId);
      const seed = await deriveBip39Seed(source);
      const accountId = this.#keyring.deriveHdAccountId({
        namespace: hdKeyring.namespace,
        seed,
        derivationIndex: hdKeyring.nextDerivationIndex,
      });
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: {
          type: "hd",
          hdKeyringId: params.hdKeyringId,
          derivationIndex: hdKeyring.nextDerivationIndex,
        },
        createdAt: this.#time.now(),
      };
      const keyringUpdate = this.#keyring.prepareAdvanceHdKeyring(params.hdKeyringId);
      const accountsUpdate = this.#accounts.prepareAddAccount(account);

      await commit([...accountsUpdate.persistenceChanges, ...keyringUpdate.persistenceChanges]);

      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#autoLock.recordActivity();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return accountId;
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

      this.#keyring.applyCommittedUpdate(keyringUpdate);
      if (accountsUpdate) this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      if (accountsUpdate) this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
    });
  }

  async setAccountHidden(params: { accountId: AccountId; hidden: boolean }): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const accountsUpdate = this.#accounts.prepareSetAccountHidden(params.accountId, params.hidden);
      if (!accountsUpdate) return;

      const permissionsUpdate = params.hidden
        ? this.#permissions.prepareRemoveAccountReferences([params.accountId])
        : null;

      await commit([...accountsUpdate.persistenceChanges, ...(permissionsUpdate?.persistenceChanges ?? [])]);

      this.#accounts.applyCommittedUpdate(accountsUpdate);
      if (permissionsUpdate) this.#permissions.applyCommittedUpdate(permissionsUpdate);
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
      if (permissionsUpdate) this.#publishPermissionsChanged(permissionsChangedFromUpdate(permissionsUpdate));
    });
  }

  private async initializeBip39Wallet(
    params: CreateFromMnemonicInput,
    backupStatus: BackupStatus,
  ): Promise<Bip39WalletCreated> {
    const keySourceId = crypto.randomUUID();
    const hdKeyringId = crypto.randomUUID();
    const source = importBip39KeySourceSecret({
      keySourceId,
      mnemonic: params.mnemonic,
    });

    return await this.#mutations.run(async (commit) => {
      if (this.#vault.getStatus() !== "uninitialized") throw new WalletAlreadyInitializedError();

      const seed = await deriveBip39Seed(source);
      const accountId = this.#keyring.deriveHdAccountId({
        namespace: params.namespace,
        seed,
        derivationIndex: 0,
      });
      const createdAt = this.#time.now();
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
        createdAt,
      };
      const keyringUpdate = this.#keyring.prepareAddBip39Source({
        source: {
          keySourceId,
          type: "bip39",
          backupStatus,
          createdAt,
        },
        hdKeyring: {
          hdKeyringId,
          namespace: params.namespace,
          nextDerivationIndex: 1,
          createdAt,
        },
      });
      const accountsUpdate = this.#accounts.prepareAddAccount(account);
      const secrets = createKeyringSecrets([source]);
      const unlocked = await createUnlockedVault({
        password: params.password,
        plaintext: encodeKeyringSecrets(secrets),
      });

      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
        ...keyringUpdate.persistenceChanges,
        ...accountsUpdate.persistenceChanges,
      ]);

      this.#vault.activate(unlocked);
      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#keyring.activateSecrets(secrets);
      this.startAutoLock();
      this.#dappConnections.refreshActiveConnectionStates();
      this.#publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return { keySourceId, hdKeyringId, accountId };
    });
  }

  private async addBip39Source(params: MnemonicSourceInput, backupStatus: BackupStatus): Promise<Bip39SourceAdded> {
    const keySourceId = crypto.randomUUID();
    const hdKeyringId = crypto.randomUUID();
    const source = importBip39KeySourceSecret({
      keySourceId,
      mnemonic: params.mnemonic,
    });

    return await this.#mutations.run(async (commit) => {
      const secrets = this.requireKeyringSecrets();
      const unlocked = this.#vault.requireUnlocked();
      const existingSource = secrets.keySources.find(
        (candidate) => candidate.type === "bip39" && candidate.mnemonic === source.mnemonic,
      );
      if (existingSource) throw new KeyringDuplicateSourceError(existingSource.keySourceId);

      const seed = await deriveBip39Seed(source);
      const accountId = this.#keyring.deriveHdAccountId({
        namespace: params.namespace,
        seed,
        derivationIndex: 0,
      });
      const createdAt = this.#time.now();
      const account: Omit<AccountRecord, "hidden"> = {
        accountId,
        origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
        createdAt,
      };
      const keyringUpdate = this.#keyring.prepareAddBip39Source({
        source: {
          keySourceId,
          type: "bip39",
          backupStatus,
          createdAt,
        },
        hdKeyring: {
          hdKeyringId,
          namespace: params.namespace,
          nextDerivationIndex: 1,
          createdAt,
        },
      });
      const accountsUpdate = this.#accounts.prepareAddAccount(account);
      const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
      const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));

      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
        ...keyringUpdate.persistenceChanges,
        ...accountsUpdate.persistenceChanges,
      ]);

      this.#vault.activate(nextUnlocked);
      this.#keyring.applyCommittedUpdate(keyringUpdate);
      this.#accounts.applyCommittedUpdate(accountsUpdate);
      this.#keyring.activateSecrets(nextSecrets);
      this.#autoLock.recordActivity();
      this.#publishKeyringChanged({ type: "keyringChanged" });
      this.#publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

      return { keySourceId, hdKeyringId, accountId };
    });
  }

  private requireKeyringSecrets(): KeyringSecrets {
    const secrets = this.#keyring.getSecrets();
    if (!secrets) throw new WalletLockedError();
    return secrets;
  }

  private requireBip39Source(secrets: KeyringSecrets, keySourceId: KeySourceId): Bip39KeySourceSecret {
    const source = findKeySourceSecret(secrets, keySourceId);
    if (source?.type !== "bip39") throw new KeySourceNotFoundError(keySourceId);
    return source;
  }

  private async verifyCurrentPassword(password: string): Promise<void> {
    // Authenticated decryption verifies the supplied password without changing session state.
    await unlockVaultRecord(this.#vault.requireRecord(), password);
  }

  private startAutoLock(): void {
    this.#autoLock.start(() => {
      void this.lock();
    });
  }
}
