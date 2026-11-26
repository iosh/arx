import type { AccountGroupId } from "../accounts/accountGroupId.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountGroup } from "../accounts/types.js";
import type { BackupStatus, KeySourceId } from "../keyring/types.js";
import type { Namespace } from "../namespaces/types.js";

export type WalletStatus = "uninitialized" | "locked" | "unlocked";

export type WalletStatusReader = Readonly<{
  getStatus(): WalletStatus;
}>;

export type WalletStatusChanged = Readonly<{
  type: "walletStatusChanged";
  status: WalletStatus;
}>;

export type KeySourceAdded = Readonly<{
  keySourceId: KeySourceId;
  accountGroupId: AccountGroupId;
}>;

export type WalletInitializationResult =
  | (KeySourceAdded & Readonly<{ status: "initialized" }>)
  | Readonly<{ status: "already-initialized" }>;

export type ImportPrivateKeySourceResult =
  | (KeySourceAdded & Readonly<{ status: "added" }>)
  | Readonly<{ status: "duplicate"; accountGroup: AccountGroup }>;

export type CreateFromMnemonicInput = Readonly<{
  password: string;
  mnemonic: string;
  name: string;
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
  backupStatus: BackupStatus;
}>;

export type AddMnemonicAndMoveAccountInput = AddMnemonicSourceInput & Readonly<{ accountId: AccountId }>;

export type AddMnemonicSourceResult =
  | (KeySourceAdded & Readonly<{ status: "added" }>)
  | Readonly<{
      status: "move-available";
      accountGroup: AccountGroup;
      /** Identifies the account whose current group is moved at confirmation. */
      accountId: AccountId;
    }>
  | Readonly<{ status: "duplicate"; walletName: string }>;

export type PrivateKeySourceInput = Readonly<{
  privateKey: string;
  namespace: Namespace;
}>;

export type MovePrivateKeyAccountInput = Readonly<{
  accountId: AccountId;
  keySourceId: KeySourceId;
}>;

/** Group visibility and any selection replacement caused by the command. */
export type SetAccountGroupHiddenResult = Readonly<{
  accountGroup: AccountGroup;
  /** Null when the selected group stays the same. */
  replacementGroup: AccountGroup | null;
}>;

export type HdAccountGroupCreationResult =
  | Readonly<{ status: "created"; accountGroup: AccountGroup }>
  | Readonly<{
      /** Leaves state unchanged. The move command checks the current account source. */
      status: "move-available";
      accountGroup: AccountGroup;
      /** Identifies the account whose current group is moved at confirmation. */
      accountId: AccountId;
    }>;
