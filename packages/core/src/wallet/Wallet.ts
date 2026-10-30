import type { AccountId } from "../accounts/accountId.js";
import type { Account } from "../accounts/types.js";
import type { BackupStatus, HdKeyringId, KeySourceId } from "../keyring/types.js";
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

export type Bip39WalletInitializationResult =
  | (Bip39SourceAdded & Readonly<{ status: "initialized" }>)
  | Readonly<{ status: "already-initialized" }>;

export type PrivateKeySourceAdded = Readonly<{
  keySourceId: KeySourceId;
  accountId: AccountId;
}>;

export type ImportPrivateKeySourceResult =
  | (PrivateKeySourceAdded & Readonly<{ status: "added" }>)
  | Readonly<{ status: "duplicate"; account: Account }>;

export type PrivateKeyWalletInitializationResult =
  | (PrivateKeySourceAdded & Readonly<{ status: "initialized" }>)
  | Readonly<{ status: "already-initialized" }>;

export type CreateFromMnemonicInput = Readonly<{
  password: string;
  mnemonic: string;
  name: string;
  namespace: Namespace;
}>;

export type RestoreFromMnemonicInput = CreateFromMnemonicInput;

export type CreateFromPrivateKeyInput = Readonly<{
  password: string;
  privateKey: string;
  namespace: Namespace;
}>;

export type AddMnemonicSourceInput = Readonly<{
  mnemonic: string;
  name: string;
  namespace: Namespace;
  backupStatus: BackupStatus;
}>;

export type AddMnemonicAndMoveAccountInput = AddMnemonicSourceInput & Readonly<{ accountId: AccountId }>;

export type AddMnemonicSourceResult =
  | (Bip39SourceAdded & Readonly<{ status: "added" }>)
  | Readonly<{ status: "move-available"; account: Account }>
  | Readonly<{ status: "duplicate"; walletName: string }>;

export type PrivateKeySourceInput = Readonly<{
  privateKey: string;
  namespace: Namespace;
}>;

export type AddHdKeyringInput = Readonly<{
  keySourceId: KeySourceId;
  namespace: Namespace;
}>;

export type MovePrivateKeyAccountInput = Readonly<{
  accountId: AccountId;
  hdKeyringId: HdKeyringId;
}>;

/** Account visibility and any selection replacement caused by the command. */
export type SetAccountHiddenResult = Readonly<{
  account: Account;
  /** Null when this command did not change the selected account. */
  replacementAccount: Account | null;
}>;

export type HdAccountCreationResult =
  | Readonly<{ status: "created"; account: Account }>
  | Readonly<{
      /** Leaves state unchanged. The move command checks the current account source. */
      status: "move-available";
      account: Account;
    }>;
