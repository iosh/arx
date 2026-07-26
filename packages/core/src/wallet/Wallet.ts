import type { AccountId } from "../accounts/accountId.js";
import type { HdKeyringId, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";

export type WalletStatus = "uninitialized" | "locked" | "unlocked";

export type WalletStatusReader = Readonly<{
  getStatus(): WalletStatus;
}>;

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
