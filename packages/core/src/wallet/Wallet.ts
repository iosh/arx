import type { AccountId } from "../accounts/accountId.js";
import type { Account, AccountAddress } from "../accounts/types.js";
import type { HdKeyring, HdKeyringId, KeySource, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";

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
    remove(params: { keySourceId: KeySourceId }): Promise<void>;
  }>;
  hdKeyrings: Readonly<{
    get(hdKeyringId: HdKeyringId): HdKeyring;
    list(): readonly HdKeyring[];
    add(params: AddHdKeyringInput): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }>;
    deriveAccount(params: { hdKeyringId: HdKeyringId }): Promise<AccountId>;
    remove(params: { hdKeyringId: HdKeyringId }): Promise<void>;
  }>;
  accounts: Readonly<{
    get(accountId: AccountId): Account;
    list(): readonly Account[];
    getAddress(params: { accountId: AccountId; chainRef: ChainRef }): AccountAddress;
    listAddresses(chainRef: ChainRef): readonly AccountAddress[];
    rename(params: { accountId: AccountId; alias?: string }): Promise<void>;
    setHidden(params: { accountId: AccountId; hidden: boolean }): Promise<void>;
    select(params: { accountId: AccountId }): Promise<void>;
  }>;
}>;
