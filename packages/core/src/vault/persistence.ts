import { defineSingletonPersistenceType, type SingletonPersistenceType } from "../persistence/definition.js";
export type EncryptedVaultRecord = Readonly<{
  version: 1;
  kdf: Readonly<{
    name: "pbkdf2";
    hash: "sha256";
    salt: string;
    iterations: number;
  }>;
  cipher: Readonly<{
    name: "aes-gcm";
    iv: string;
    data: string;
  }>;
}>;

export interface EncryptedVaultReader {
  get(): Promise<EncryptedVaultRecord | null>;
}

export const encryptedVaultPersistenceType: SingletonPersistenceType<"encryptedVault", EncryptedVaultRecord> =
  defineSingletonPersistenceType<"encryptedVault", EncryptedVaultRecord>("encryptedVault");
