import type { EncryptedVaultRecord, WalletChainSelectionRecord } from "@arx/core/persistence";
import {
  ENCRYPTED_VAULT_ROW_KEY,
  type EncryptedVaultRow,
  WALLET_CHAIN_SELECTION_ROW_KEY,
  type WalletChainSelectionRow,
} from "../rows.js";

export const encryptedVaultToRow = (record: EncryptedVaultRecord): EncryptedVaultRow => ({
  key: ENCRYPTED_VAULT_ROW_KEY,
  salt: record.salt,
  iv: record.iv,
  ciphertext: record.ciphertext,
});

export const encryptedVaultFromRow = (row: EncryptedVaultRow): EncryptedVaultRecord => ({
  salt: row.salt,
  iv: row.iv,
  ciphertext: row.ciphertext,
});

export const walletChainSelectionToRow = (record: WalletChainSelectionRecord): WalletChainSelectionRow => ({
  ...record,
  key: WALLET_CHAIN_SELECTION_ROW_KEY,
});

export const walletChainSelectionFromRow = ({
  key: _key,
  ...record
}: WalletChainSelectionRow): WalletChainSelectionRecord => record;
