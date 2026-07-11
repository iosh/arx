import type {
  AccountRecord,
  AccountSelectionRecord,
  ChainRpcOverrideRecord,
  CustomChainRecord,
  EncryptedVaultRecord,
  HdKeyringRecord,
  KeySourceRecord,
  PermissionRecord,
  ProviderChainSelectionRecord,
  SettingRecord,
  TransactionRecord,
  WalletChainSelectionRecord,
} from "@arx/core/persistence";

export const ENCRYPTED_VAULT_ROW_KEY = "encryptedVault" as const;
export const WALLET_CHAIN_SELECTION_ROW_KEY = "walletChainSelection" as const;

export type EncryptedVaultRow = EncryptedVaultRecord & {
  key: typeof ENCRYPTED_VAULT_ROW_KEY;
};

export type SettingRow = SettingRecord;
export type KeySourceRow = KeySourceRecord;
export type HdKeyringRow = HdKeyringRecord;

export type AccountRow = AccountRecord & {
  namespace: string;
  hdKeyringId?: string;
  privateKeySourceId?: string;
};

export type AccountSelectionRow = AccountSelectionRecord;

export type PermissionRow = PermissionRecord & {
  indexedAccountIds: string[];
  indexedChainRefs: string[];
};

export type CustomChainRow = CustomChainRecord;
export type ChainRpcOverrideRow = ChainRpcOverrideRecord;

export type WalletChainSelectionRow = WalletChainSelectionRecord & {
  key: typeof WALLET_CHAIN_SELECTION_ROW_KEY;
};

export type ProviderChainSelectionRow = ProviderChainSelectionRecord;
export type TransactionRow = TransactionRecord;
