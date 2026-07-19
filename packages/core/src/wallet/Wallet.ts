import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import type { Account, AccountAddress, AccountsChanged } from "../accounts/types.js";
import type { ChainRef } from "../chains/ids.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError } from "../keyring/errors.js";
import type { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapters } from "../keyring/namespaceAdapter.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import type { HdKeyring, KeySource } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import type { VaultBootstrap } from "../vault/bootstrap.js";
import { Vault } from "../vault/Vault.js";
import { AutoLockController } from "./AutoLockController.js";
import type { WalletBootstrap } from "./bootstrap.js";
import { addHdKeyring, deriveHdAccount } from "./keyrings.js";
import {
  addMnemonic,
  confirmMnemonicBackup,
  exportMnemonic,
  exportPrivateKey,
  generateMnemonic,
  importMnemonic,
  importPrivateKey,
} from "./keySources.js";
import { changePassword, lock, setAutoLockDuration, unlock } from "./locking.js";
import { createFromMnemonic, createFromPrivateKey, restoreFromMnemonic } from "./setup.js";

export type WalletStatus = "uninitialized" | "locked" | "unlocked";

export type WalletStatusChanged = Readonly<{
  type: "walletStatusChanged";
  status: WalletStatus;
}>;

export type Bip39SourceAdded = Readonly<{
  keySourceId: KeySourceId;
  hdKeyringId: HdKeyringId;
  accountId: AccountId;
}>;

export type Bip39WalletCreated = Bip39SourceAdded;

export type PrivateKeySourceAdded = Readonly<{
  keySourceId: KeySourceId;
  accountId: AccountId;
}>;

export type PrivateKeyWalletCreated = PrivateKeySourceAdded;

export type CreateFromMnemonicInput = Readonly<{
  password: string;
  mnemonic: string;
  namespace: Namespace;
}>;

export type RestoreFromMnemonicInput = CreateFromMnemonicInput;

export type CreateFromPrivateKeyInput = Readonly<{
  password: string;
  privateKey: string;
  namespace: Namespace;
}>;

export type MnemonicSourceInput = Readonly<{
  mnemonic: string;
  namespace: Namespace;
}>;

export type PrivateKeySourceInput = Readonly<{
  privateKey: string;
  namespace: Namespace;
}>;

export type AddHdKeyringInput = Readonly<{
  keySourceId: KeySourceId;
  namespace: Namespace;
}>;

export type WalletContext = Readonly<{
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
  keySources: Readonly<{
    generateMnemonic(): { mnemonic: string };
    get(keySourceId: KeySourceId): KeySource;
    list(): readonly KeySource[];
    addMnemonic(params: MnemonicSourceInput): Promise<Bip39SourceAdded>;
    importMnemonic(params: MnemonicSourceInput): Promise<Bip39SourceAdded>;
    importPrivateKey(params: PrivateKeySourceInput): Promise<PrivateKeySourceAdded>;
    confirmMnemonicBackup(params: { keySourceId: KeySourceId }): Promise<void>;
    exportMnemonic(params: { keySourceId: KeySourceId; password: string }): Promise<{ mnemonic: string }>;
    exportPrivateKey(params: { keySourceId: KeySourceId; password: string }): Promise<{ privateKey: string }>;
  }>;
  hdKeyrings: Readonly<{
    get(hdKeyringId: HdKeyringId): HdKeyring;
    list(): readonly HdKeyring[];
    add(params: AddHdKeyringInput): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }>;
    deriveAccount(params: { hdKeyringId: HdKeyringId }): Promise<AccountId>;
  }>;
  accounts: Readonly<{
    get(accountId: AccountId): Account;
    list(): readonly Account[];
    getAddress(params: { accountId: AccountId; chainRef: ChainRef }): AccountAddress;
    listAddresses(chainRef: ChainRef): readonly AccountAddress[];
    rename(params: { accountId: AccountId; alias?: string }): Promise<void>;
    select(params: { accountId: AccountId }): Promise<void>;
  }>;
}>;

export const createWallet = (params: {
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
    keySources: {
      generateMnemonic,
      get: (keySourceId) => {
        const keySource = keyring.getKeySource(keySourceId);
        if (!keySource) throw new KeySourceNotFoundError(keySourceId);
        return keySource;
      },
      list: () => keyring.listKeySources(),
      addMnemonic: (input) => addMnemonic(context, input),
      importMnemonic: (input) => importMnemonic(context, input),
      importPrivateKey: (input) => importPrivateKey(context, input),
      confirmMnemonicBackup: (input) => confirmMnemonicBackup(context, input),
      exportMnemonic: (input) => exportMnemonic(context, input),
      exportPrivateKey: (input) => exportPrivateKey(context, input),
    },
    hdKeyrings: {
      get: (hdKeyringId) => {
        const hdKeyring = keyring.getHdKeyring(hdKeyringId);
        if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);
        return hdKeyring;
      },
      list: () => keyring.listHdKeyrings(),
      add: (input) => addHdKeyring(context, input),
      deriveAccount: (input) => deriveHdAccount(context, input.hdKeyringId),
    },
    accounts: {
      get: (accountId) => {
        const account = params.accounts.getAccount(accountId);
        if (!account) throw new AccountNotFoundError(accountId);
        return account;
      },
      list: () => params.accounts.listAccounts(),
      getAddress: (input) => params.accounts.getAddress(input),
      listAddresses: (chainRef) => params.accounts.listAddresses(chainRef),
      rename: (input) => params.accounts.rename(input),
      select: (input) => params.accounts.select(input.accountId),
    },
  };
};
