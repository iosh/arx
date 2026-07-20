import type {
  AccountRecord,
  AccountSelectionRecord,
  CustomNetworkRecord,
  EncryptedVaultRecord,
  HdKeyringRecord,
  KeySourceRecord,
  NetworkRpcOverrideRecord,
  NetworkSelectionRecord,
  PermissionRecord,
  ProviderChainSelectionRecord,
  SettingRecord,
  TransactionRecord,
} from "@arx/core/persistence";

export const ENCRYPTED_VAULT_ROW_KEY = "encryptedVault" as const;
export const NETWORK_SELECTION_ROW_KEY = "networkSelection" as const;

export type EncryptedVaultRow = EncryptedVaultRecord & {
  key: typeof ENCRYPTED_VAULT_ROW_KEY;
};

export type SettingsRow = SettingRecord;

export type KeySourceRow = KeySourceRecord;
export type HdKeyringRow = HdKeyringRecord;
export type AccountRow = AccountRecord;
export type AccountSelectionRow = AccountSelectionRecord;

export type PermissionRow = PermissionRecord & {
  indexedAccountIds: string[];
  indexedChainRefs: string[];
};

export type CustomNetworkRow = CustomNetworkRecord;
export type NetworkRpcOverrideRow = NetworkRpcOverrideRecord;

export type NetworkSelectionRow = NetworkSelectionRecord & {
  key: typeof NETWORK_SELECTION_ROW_KEY;
};

export type ProviderChainSelectionRow = ProviderChainSelectionRecord;
export type TransactionRow = TransactionRecord;
