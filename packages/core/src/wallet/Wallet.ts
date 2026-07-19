import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountsChanged } from "../accounts/types.js";
import type { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapters } from "../keyring/namespaceAdapter.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import type { VaultBootstrap } from "../vault/bootstrap.js";
import { Vault } from "../vault/Vault.js";
import { AutoLockController } from "./AutoLockController.js";
import type { WalletBootstrap } from "./bootstrap.js";
import { addHdKeyring, deriveHdAccount, removeHdKeyring } from "./keyrings.js";
import {
  addNewMnemonic,
  confirmMnemonicBackup,
  importMnemonic,
  importPrivateKey,
  removeKeySource,
} from "./keySources.js";
import { changePassword, lock, setAutoLockDuration, unlock } from "./locking.js";
import { createFromMnemonic, createFromPrivateKey, restoreFromMnemonic } from "./setup.js";

export type WalletStatus = "uninitialized" | "locked" | "unlocked";

export type WalletStatusChanged = Readonly<{
  type: "walletStatusChanged";
  status: WalletStatus;
}>;

export type Bip39WalletCreated = Readonly<{
  keySourceId: KeySourceId;
  hdKeyringId: HdKeyringId;
  accountId: AccountId;
}>;

export type PrivateKeyWalletCreated = Readonly<{
  keySourceId: KeySourceId;
  accountId: AccountId;
}>;

export type CreateFromMnemonicInput = Readonly<{
  password: string;
  mnemonic: string;
  namespace: string;
}>;

export type RestoreFromMnemonicInput = CreateFromMnemonicInput;

export type CreateFromPrivateKeyInput = Readonly<{
  password: string;
  privateKey: string;
  namespace: string;
}>;

export type WalletContext = Readonly<{
  readers: Pick<CorePersistenceReaders, "permissions">;
  mutations: CoreMutationQueue;
  time: CoreTime;
  vault: Vault;
  keyring: Keyring;
  accounts: Accounts;
  autoLock: AutoLockController;
  adapters: KeyringNamespaceAdapters;
  /** Publishes a committed Wallet status change and must not throw. */
  publishStatusChanged(change: WalletStatusChanged): void;
  /** Publishes committed key source/HD keyring record changes and must not throw. */
  publishKeyringChanged(): void;
  /** Publishes committed account record/selection changes and must not throw. */
  publishAccountsChanged(change: AccountsChanged): void;
}>;

export type Wallet = Readonly<{
  getStatus(): WalletStatus;
  getAutoLockDuration(): number;
  createFromMnemonic(params: CreateFromMnemonicInput): Promise<Bip39WalletCreated>;
  restoreFromMnemonic(params: RestoreFromMnemonicInput): Promise<Bip39WalletCreated>;
  createFromPrivateKey(params: CreateFromPrivateKeyInput): Promise<PrivateKeyWalletCreated>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  changePassword(params: { currentPassword: string; newPassword: string }): Promise<void>;
  setAutoLockDuration(durationMs: number): Promise<void>;
  accounts: Readonly<{
    rename(params: { accountId: AccountId; alias?: string }): Promise<void>;
    select(accountId: AccountId): Promise<void>;
  }>;
  keySources: Readonly<{
    addMnemonic(params: { mnemonic: string; namespace: string }): Promise<AccountId>;
    importMnemonic(params: { mnemonic: string; namespace: string }): Promise<AccountId>;
    importPrivateKey(params: { privateKey: string; namespace: string }): Promise<AccountId>;
    confirmBackup(params: { keySourceId: KeySourceId }): Promise<void>;
    remove(keySourceId: KeySourceId): Promise<void>;
  }>;
  keyrings: Readonly<{
    add(params: { keySourceId: KeySourceId; namespace: string }): Promise<AccountId>;
    deriveAccount(hdKeyringId: HdKeyringId): Promise<AccountId>;
    remove(hdKeyringId: HdKeyringId): Promise<void>;
  }>;
}>;

export const createWallet = (params: {
  readers: WalletContext["readers"];
  mutations: CoreMutationQueue;
  keyring: Keyring;
  accounts: Accounts;
  adapters: KeyringNamespaceAdapters;
  time: CoreTime;
  vaultBootstrap: VaultBootstrap;
  walletBootstrap: WalletBootstrap;
  /** Publishes a committed Wallet status change and must not throw. */
  publishStatusChanged(change: WalletStatusChanged): void;
  /** Publishes committed key source/HD keyring record changes and must not throw. */
  publishKeyringChanged(): void;
  /** Publishes committed account record/selection changes and must not throw. */
  publishAccountsChanged(change: AccountsChanged): void;
}): Wallet => {
  const vault = new Vault(params.vaultBootstrap.encryptedVault);
  const keyring = params.keyring;
  const autoLock = new AutoLockController({
    durationMs: params.walletBootstrap.autoLockDurationMs,
    time: params.time,
    lock: () => {
      void lock(context);
    },
  });
  const context: WalletContext = {
    readers: params.readers,
    mutations: params.mutations,
    time: params.time,
    vault,
    keyring,
    accounts: params.accounts,
    autoLock,
    adapters: params.adapters,
    publishStatusChanged: params.publishStatusChanged,
    publishKeyringChanged: params.publishKeyringChanged,
    publishAccountsChanged: params.publishAccountsChanged,
  };

  return {
    getStatus: () => vault.getStatus(),
    getAutoLockDuration: () => autoLock.getDuration(),
    createFromMnemonic: (input) => createFromMnemonic(context, input),
    restoreFromMnemonic: (input) => restoreFromMnemonic(context, input),
    createFromPrivateKey: (input) => createFromPrivateKey(context, input),
    unlock: (password) => unlock(context, password),
    lock: () => lock(context),
    changePassword: (input) => changePassword(context, input),
    setAutoLockDuration: (durationMs) => setAutoLockDuration(context, durationMs),
    accounts: {
      rename: (input) => params.accounts.rename(input),
      select: (accountId) => params.accounts.select(accountId),
    },
    keySources: {
      addMnemonic: (input) => addNewMnemonic(context, input),
      importMnemonic: (input) => importMnemonic(context, input),
      importPrivateKey: (input) => importPrivateKey(context, input),
      confirmBackup: (input) => confirmMnemonicBackup(context, input),
      remove: (keySourceId) => removeKeySource(context, keySourceId),
    },
    keyrings: {
      add: (input) => addHdKeyring(context, input),
      deriveAccount: (hdKeyringId) => deriveHdAccount(context, hdKeyringId),
      remove: (hdKeyringId) => removeHdKeyring(context, hdKeyringId),
    },
  };
};
