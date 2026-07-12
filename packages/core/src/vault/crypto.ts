import { isArxBaseError } from "../errors.js";
import { VaultInvalidPasswordError } from "./errors.js";
import type { EncryptedVaultRecord } from "./persistence.js";
import { decodeVaultSecrets, encodeVaultSecrets, type VaultSecrets } from "./secrets.js";
import type { VaultConfig } from "./types.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveKeyMaterial,
  fromBase64,
  importPasswordKey,
  randomBytes,
  toBase64,
} from "./utils.js";

type ResolvedVaultConfig = Readonly<{
  iterations: number;
  saltBytes: number;
  ivBytes: number;
}>;

export type UnlockedVault = Readonly<{
  record: EncryptedVaultRecord;
  secrets: VaultSecrets;
  keyMaterial: Uint8Array;
}>;

const DEFAULT_CONFIG: ResolvedVaultConfig = {
  iterations: 100_000,
  saltBytes: 16,
  ivBytes: 12,
};

const resolveConfig = (config?: VaultConfig): ResolvedVaultConfig => ({
  iterations: config?.iterations ?? DEFAULT_CONFIG.iterations,
  saltBytes: config?.saltBytes ?? DEFAULT_CONFIG.saltBytes,
  ivBytes: config?.ivBytes ?? DEFAULT_CONFIG.ivBytes,
});

const derivePasswordKey = async (password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> => {
  const passwordKey = await importPasswordKey(password);
  return await deriveKeyMaterial(passwordKey, salt, iterations);
};

const encrypt = async (params: {
  secrets: VaultSecrets;
  keyMaterial: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  ivBytes: number;
}): Promise<EncryptedVaultRecord> => {
  const { cipher, iv } = await aesGcmEncrypt(params.keyMaterial, encodeVaultSecrets(params.secrets), params.ivBytes);
  return {
    version: 1,
    kdf: {
      name: "pbkdf2",
      hash: "sha256",
      salt: toBase64(params.salt),
      iterations: params.iterations,
    },
    cipher: {
      name: "aes-gcm",
      iv: toBase64(iv),
      data: toBase64(cipher),
    },
  };
};

export const createUnlockedVault = async (params: {
  password: string;
  secrets: VaultSecrets;
  config?: VaultConfig;
}): Promise<UnlockedVault> => {
  const config = resolveConfig(params.config);
  const salt = randomBytes(config.saltBytes);
  const keyMaterial = await derivePasswordKey(params.password, salt, config.iterations);
  const secrets = structuredClone(params.secrets);
  const record = await encrypt({
    secrets,
    keyMaterial,
    salt,
    iterations: config.iterations,
    ivBytes: config.ivBytes,
  });
  return { record, secrets, keyMaterial };
};

export const unlockVaultRecord = async (record: EncryptedVaultRecord, password: string): Promise<UnlockedVault> => {
  try {
    const keyMaterial = await derivePasswordKey(password, fromBase64(record.kdf.salt), record.kdf.iterations);
    const plaintext = await aesGcmDecrypt(keyMaterial, fromBase64(record.cipher.data), fromBase64(record.cipher.iv));
    return {
      record: structuredClone(record),
      secrets: decodeVaultSecrets(plaintext),
      keyMaterial,
    };
  } catch (error) {
    if (isArxBaseError(error) && error.code === "vault.invalid_ciphertext") {
      throw new VaultInvalidPasswordError();
    }
    throw error;
  }
};

export const replaceVaultSecrets = async (
  unlocked: UnlockedVault,
  secrets: VaultSecrets,
  config?: VaultConfig,
): Promise<UnlockedVault> => {
  const resolved = resolveConfig(config);
  const nextSecrets = structuredClone(secrets);
  const record = await encrypt({
    secrets: nextSecrets,
    keyMaterial: unlocked.keyMaterial,
    salt: fromBase64(unlocked.record.kdf.salt),
    iterations: unlocked.record.kdf.iterations,
    ivBytes: resolved.ivBytes,
  });
  return { record, secrets: nextSecrets, keyMaterial: unlocked.keyMaterial };
};

export const changeVaultPassword = async (params: {
  unlocked: UnlockedVault;
  currentPassword: string;
  newPassword: string;
  config?: VaultConfig;
}): Promise<UnlockedVault> => {
  await unlockVaultRecord(params.unlocked.record, params.currentPassword);
  return await createUnlockedVault({
    password: params.newPassword,
    secrets: params.unlocked.secrets,
    ...(params.config ? { config: params.config } : {}),
  });
};
