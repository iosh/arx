import { gcm } from "@noble/ciphers/aes.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";
import * as Base64 from "ox/Base64";
import {
  VaultCryptoOperationError,
  VaultIncorrectPasswordError,
  VaultPasswordTooShortError,
  VaultRecordDecodeError,
} from "./errors.js";
import { getVaultPasswordLength, VAULT_PASSWORD_MIN_LENGTH } from "./passwordPolicy.js";
import type { EncryptedVaultRecord } from "./persistence.js";

/**
 * Vault password-derivation profile.
 *
 * N=2^16, r=8, p=2 is the 64 MiB scrypt profile recommended for reducing peak
 * memory while retaining comparable work to N=2^17, r=8, p=1. dkLen=32
 * derives the AES-256 key. Persisted records rely on these implicit parameters,
 * so changing them requires an explicit format migration.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
 */
const SCRYPT_OPTIONS = {
  N: 2 ** 16,
  r: 8,
  p: 2,
  dkLen: 32,
} as const;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type UnlockedVault = Readonly<{
  record: EncryptedVaultRecord;
  encryptionKey: Uint8Array;
}>;

export type VaultUnlockDraft = Readonly<{
  plaintext: Uint8Array;
  unlocked: UnlockedVault;
}>;

const decodeRecord = (record: EncryptedVaultRecord) => {
  try {
    return {
      salt: Base64.toBytes(record.salt),
      iv: Base64.toBytes(record.iv),
      ciphertext: Base64.toBytes(record.ciphertext),
    };
  } catch (cause) {
    throw new VaultRecordDecodeError(cause);
  }
};

const createRandomBytes = (size: number): Uint8Array => {
  try {
    return randomBytes(size);
  } catch (cause) {
    throw new VaultCryptoOperationError("random-bytes", cause);
  }
};

const deriveEncryptionKey = async (password: string, salt: Uint8Array): Promise<Uint8Array> => {
  try {
    return await scryptAsync(password, salt, SCRYPT_OPTIONS);
  } catch (cause) {
    throw new VaultCryptoOperationError("derive-encryption-key", cause);
  }
};

const assertNewVaultPassword = (password: string): void => {
  const actualLength = getVaultPasswordLength(password);
  if (actualLength < VAULT_PASSWORD_MIN_LENGTH) {
    throw new VaultPasswordTooShortError(VAULT_PASSWORD_MIN_LENGTH, actualLength);
  }
};

const encrypt = (encryptionKey: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array => {
  try {
    return gcm(encryptionKey, iv).encrypt(plaintext);
  } catch (cause) {
    throw new VaultCryptoOperationError("encrypt", cause);
  }
};

const createUnlockedVaultWithSalt = async (params: {
  password: string;
  plaintext: Uint8Array;
  salt: Uint8Array;
}): Promise<UnlockedVault> => {
  const encryptionKey = await deriveEncryptionKey(params.password, params.salt);
  const iv = createRandomBytes(IV_BYTES);
  const ciphertext = encrypt(encryptionKey, iv, params.plaintext);
  return {
    record: {
      salt: Base64.fromBytes(params.salt),
      iv: Base64.fromBytes(iv),
      ciphertext: Base64.fromBytes(ciphertext),
    },
    encryptionKey,
  };
};

export const createUnlockedVault = async (params: {
  password: string;
  plaintext: Uint8Array;
}): Promise<UnlockedVault> => {
  assertNewVaultPassword(params.password);

  return await createUnlockedVaultWithSalt({
    password: params.password,
    plaintext: params.plaintext,
    salt: createRandomBytes(SALT_BYTES),
  });
};

export const unlockVaultRecord = async (record: EncryptedVaultRecord, password: string): Promise<VaultUnlockDraft> => {
  const decoded = decodeRecord(record);
  const encryptionKey = await deriveEncryptionKey(password, decoded.salt);
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(encryptionKey, decoded.iv).decrypt(decoded.ciphertext);
  } catch {
    throw new VaultIncorrectPasswordError();
  }
  return {
    plaintext,
    unlocked: {
      record,
      encryptionKey,
    },
  };
};

export const replaceVaultPlaintext = async (unlocked: UnlockedVault, plaintext: Uint8Array): Promise<UnlockedVault> => {
  const iv = createRandomBytes(IV_BYTES);
  const ciphertext = encrypt(unlocked.encryptionKey, iv, plaintext);
  return {
    record: {
      salt: unlocked.record.salt,
      iv: Base64.fromBytes(iv),
      ciphertext: Base64.fromBytes(ciphertext),
    },
    encryptionKey: unlocked.encryptionKey,
  };
};

export const changeVaultPassword = async (params: {
  unlocked: UnlockedVault;
  currentPassword: string;
  newPassword: string;
}): Promise<UnlockedVault> => {
  const current = await unlockVaultRecord(params.unlocked.record, params.currentPassword);
  return await createUnlockedVault({
    password: params.newPassword,
    plaintext: current.plaintext,
  });
};
