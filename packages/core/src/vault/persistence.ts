import { defineSingletonPersistenceType, type SingletonPersistenceType } from "../persistence/definition.js";

export type EncryptedVaultRecord = Readonly<{
  salt: string;
  iv: string;
  ciphertext: string;
}>;

export interface EncryptedVaultReader {
  get(): Promise<EncryptedVaultRecord | null>;
}

export const encryptedVaultPersistenceType: SingletonPersistenceType<"encryptedVault", EncryptedVaultRecord> =
  defineSingletonPersistenceType<"encryptedVault", EncryptedVaultRecord>("encryptedVault");
