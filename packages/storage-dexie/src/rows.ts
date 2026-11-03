import type {
  AccountGroupRecord,
  AccountMemberRecord,
  AccountSelectionRecord,
  CustomNetworkRecord,
  DappNetworkSelectionRecord,
  EncryptedVaultRecord,
  HdKeyringRecord,
  KeySourceRecord,
  NetworkRpcOverrideRecord,
  PermissionRecord,
  SettingRecord,
  TransactionRecord,
} from "@arx/core/persistence";

export const ENCRYPTED_VAULT_ROW_KEY = "encryptedVault" as const;

export type EncryptedVaultRow = EncryptedVaultRecord & {
  key: typeof ENCRYPTED_VAULT_ROW_KEY;
};

export type SettingsRow = SettingRecord;

export type KeySourceRow = KeySourceRecord;
export type HdKeyringRow = HdKeyringRecord;
export type AccountRow = AccountMemberRecord;
export type AccountGroupRow = AccountGroupRecord;
export const ACCOUNT_SELECTION_ROW_KEY = "accountSelection" as const;
export type AccountSelectionRow = AccountSelectionRecord & { key: typeof ACCOUNT_SELECTION_ROW_KEY };

export type PermissionRow = PermissionRecord;

export type CustomNetworkRow = CustomNetworkRecord;
export type NetworkRpcOverrideRow = NetworkRpcOverrideRecord;

export type DappNetworkSelectionRow = DappNetworkSelectionRecord;
export type TransactionRow = TransactionRecord;
