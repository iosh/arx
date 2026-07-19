import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountsChanged } from "../accounts/types.js";
import type { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapters } from "../keyring/namespaceAdapter.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { VaultBootstrap } from "../vault/bootstrap.js";
import { Vault, type VaultStatus } from "../vault/Vault.js";
import { AutoLockTimer } from "./AutoLockTimer.js";
import { addHdKeyring, deriveHdAccount, removeHdKeyring } from "./keyrings.js";
import {
  addNewMnemonic,
  confirmMnemonicBackup,
  importMnemonic,
  importPrivateKey,
  removeKeySource,
} from "./keySources.js";
import { changePassword, lock, setAutoLockDuration, unlock } from "./locking.js";
import { deleteWallet } from "./removal.js";
import { initializeFromMnemonic, initializeFromPrivateKey, initializeWithNewMnemonic } from "./setup.js";

export type WalletChanged = Readonly<{
  vault?: boolean;
  autoLock?: boolean;
}>;

export type WalletContext = Readonly<{
  readers: Pick<CorePersistenceReaders, "encryptedVault" | "permissions">;
  mutations: CoreMutationQueue;
  vault: Vault;
  keyring: Keyring;
  accounts: Accounts;
  autoLock: AutoLockTimer;
  adapters: KeyringNamespaceAdapters;
  /** Publishes committed wallet changes and must not throw. */
  publishChanged(change: WalletChanged): void;
  /** Publishes committed key source/HD keyring record changes and must not throw. */
  publishKeyringChanged(): void;
  /** Publishes committed account record/selection changes and must not throw. */
  publishAccountsChanged(change: AccountsChanged): void;
}>;

export type Wallet = Readonly<{
  getStatus(): VaultStatus;
  getAutoLock(): Readonly<{ durationMs: number; deadline: number | null }>;
  initializeWithNewMnemonic(params: { password: string; mnemonic: string; namespace: string }): Promise<AccountId>;
  initializeFromMnemonic(params: { password: string; mnemonic: string; namespace: string }): Promise<AccountId>;
  initializeFromPrivateKey(params: { password: string; privateKey: string; namespace: string }): Promise<AccountId>;
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
  deleteIdentity(): Promise<void>;
}>;

export const createWallet = (params: {
  readers: WalletContext["readers"];
  mutations: CoreMutationQueue;
  keyring: Keyring;
  accounts: Accounts;
  adapters: KeyringNamespaceAdapters;
  bootstrap: VaultBootstrap;
  /** Publishes committed wallet changes and must not throw. */
  publishChanged(change: WalletChanged): void;
  /** Publishes committed key source/HD keyring record changes and must not throw. */
  publishKeyringChanged(): void;
  /** Publishes committed account record/selection changes and must not throw. */
  publishAccountsChanged(change: AccountsChanged): void;
}): Wallet => {
  const vault = new Vault(params.bootstrap.encryptedVault);
  const keyring = params.keyring;
  let expire = (): void => {};
  const autoLock = new AutoLockTimer({
    durationMs: params.bootstrap.autoLockDurationMs,
    onExpire: () => expire(),
  });
  const context: WalletContext = {
    readers: params.readers,
    mutations: params.mutations,
    vault,
    keyring,
    accounts: params.accounts,
    autoLock,
    adapters: params.adapters,
    publishChanged: params.publishChanged,
    publishKeyringChanged: params.publishKeyringChanged,
    publishAccountsChanged: params.publishAccountsChanged,
  };
  expire = () => {
    void lock(context);
  };

  return {
    getStatus: () => vault.getStatus(),
    getAutoLock: () => ({ durationMs: autoLock.getDuration(), deadline: autoLock.getDeadline() }),
    initializeWithNewMnemonic: (input) => initializeWithNewMnemonic(context, input),
    initializeFromMnemonic: (input) => initializeFromMnemonic(context, input),
    initializeFromPrivateKey: (input) => initializeFromPrivateKey(context, input),
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
    deleteIdentity: () => deleteWallet(context),
  };
};
