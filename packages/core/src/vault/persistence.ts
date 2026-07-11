import { defineSingletonPersistenceType, type SingletonPersistenceType } from "../persistence/definition.js";
import type { VaultEnvelope } from "./types.js";

export type EncryptedVaultRecord = Readonly<VaultEnvelope>;

export interface EncryptedVaultReader {
  get(): Promise<EncryptedVaultRecord | null>;
}

export const encryptedVaultPersistenceType: SingletonPersistenceType<"encryptedVault", EncryptedVaultRecord> =
  defineSingletonPersistenceType<"encryptedVault", EncryptedVaultRecord>("encryptedVault");
