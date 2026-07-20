import type { EncryptedVaultRecord, NetworkSelectionRecord } from "@arx/core/persistence";
import {
  ENCRYPTED_VAULT_ROW_KEY,
  type EncryptedVaultRow,
  NETWORK_SELECTION_ROW_KEY,
  type NetworkSelectionRow,
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

export const networkSelectionToRow = (record: NetworkSelectionRecord): NetworkSelectionRow => ({
  ...record,
  key: NETWORK_SELECTION_ROW_KEY,
});

export const networkSelectionFromRow = ({ key: _key, ...record }: NetworkSelectionRow): NetworkSelectionRecord =>
  record;
