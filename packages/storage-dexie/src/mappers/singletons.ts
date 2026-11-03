import type { EncryptedVaultRecord } from "@arx/core/persistence";
import { ENCRYPTED_VAULT_ROW_KEY, type EncryptedVaultRow } from "../rows.js";

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
