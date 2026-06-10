import { isArxBaseError } from "../error.js";
import { copyBytes, zeroize } from "../utils/bytes.js";
import {
  VaultInvalidCiphertextError,
  VaultInvalidPasswordError,
  VaultInvariantViolationError,
  VaultLockedError,
  VaultNotInitializedError,
} from "./errors.js";
import type {
  CommitSecretParams,
  ReencryptVaultParams,
  SealVaultParams,
  UnlockVaultParams,
  VaultConfig,
  VaultEnvelope,
  VaultService,
  VaultStatus,
} from "./types.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveKeyMaterial,
  fromBase64,
  importPasswordKey,
  randomBytes,
  toBase64,
} from "./utils.js";

type ResolvedVaultConfig = {
  iterations: number;
  saltBytes: number;
  ivBytes: number;
};

const DEFAULT_CONFIG: ResolvedVaultConfig = {
  // Target: ~200ms on typical devices; can be tuned per platform.
  iterations: 600_000,
  saltBytes: 16,
  ivBytes: 12,
};

export const VAULT_VERSION = 1 as const;

const VAULT_KDF = { name: "pbkdf2", hash: "sha256" } as const;
const VAULT_CIPHER = { name: "aes-gcm" } as const;

const assertPositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
};

const deriveVaultConfig = (config?: VaultConfig): ResolvedVaultConfig => {
  const iterations = config?.iterations ?? DEFAULT_CONFIG.iterations;
  const saltBytes = config?.saltBytes ?? DEFAULT_CONFIG.saltBytes;
  const ivBytes = config?.ivBytes ?? DEFAULT_CONFIG.ivBytes;

  assertPositiveInteger(iterations, "PBKDF2 iteration count");
  assertPositiveInteger(saltBytes, "Salt length");
  assertPositiveInteger(ivBytes, "AES-GCM IV length");

  return { iterations, saltBytes, ivBytes };
};

const cloneEnvelope = (envelope: VaultEnvelope): VaultEnvelope => ({
  version: envelope.version,
  kdf: { ...envelope.kdf },
  cipher: { ...envelope.cipher },
});

const decodeEnvelopeOrThrow = (value: VaultEnvelope) => {
  if (value.version !== VAULT_VERSION) throw new VaultInvalidCiphertextError();
  if (value.kdf.name !== VAULT_KDF.name || value.kdf.hash !== VAULT_KDF.hash) throw new VaultInvalidCiphertextError();
  if (value.cipher.name !== VAULT_CIPHER.name) throw new VaultInvalidCiphertextError();

  try {
    const saltBytes = fromBase64(value.kdf.salt);
    const ivBytes = fromBase64(value.cipher.iv);
    const dataBytes = fromBase64(value.cipher.data);
    if (!saltBytes.length || !ivBytes.length || !dataBytes.length) {
      throw new Error("Decoded envelope is empty");
    }

    // Normalize malformed envelopes to a stable VaultInvalidCiphertext reason.
    const iterations = value.kdf.iterations;
    if (!Number.isInteger(iterations) || iterations <= 0) {
      throw new Error("PBKDF2 iteration count must be a positive integer");
    }

    return {
      envelope: cloneEnvelope(value),
      saltBytes,
      iterations,
      ivBytes,
      dataBytes,
    };
  } catch {
    throw new VaultInvalidCiphertextError();
  }
};

export const createVaultService = (config?: VaultConfig): VaultService => {
  const resolved = deriveVaultConfig(config);

  let envelope: VaultEnvelope | null = null;
  let derivedKey: Uint8Array | null = null;
  let secret: Uint8Array | null = null;

  const clearSession = () => {
    if (derivedKey) {
      zeroize(derivedKey);
      derivedKey = null;
    }
    if (secret) {
      zeroize(secret);
      secret = null;
    }
  };

  const decryptWithPassword = async (params: {
    password: string;
    decoded: ReturnType<typeof decodeEnvelopeOrThrow>;
  }): Promise<{ keyMaterial: Uint8Array; plain: Uint8Array }> => {
    const passwordKey = await importPasswordKey(params.password);
    let keyMaterial: Uint8Array | null = null;
    try {
      keyMaterial = await deriveKeyMaterial(passwordKey, params.decoded.saltBytes, params.decoded.iterations);
      const plain = await aesGcmDecrypt(keyMaterial, params.decoded.dataBytes, params.decoded.ivBytes);
      return { keyMaterial, plain };
    } catch (error) {
      if (keyMaterial) zeroize(keyMaterial);
      throw error;
    }
  };

  const encryptWithPassword = async (params: {
    password: string;
    secret: Uint8Array;
    saltBytes: Uint8Array;
    iterations: number;
  }): Promise<{ keyMaterial: Uint8Array; envelope: VaultEnvelope }> => {
    const passwordKey = await importPasswordKey(params.password);
    let keyMaterial: Uint8Array | null = null;
    try {
      keyMaterial = await deriveKeyMaterial(passwordKey, params.saltBytes, params.iterations);
      const { cipher, iv } = await aesGcmEncrypt(keyMaterial, params.secret, resolved.ivBytes);

      return {
        keyMaterial,
        envelope: {
          version: VAULT_VERSION,
          kdf: {
            name: VAULT_KDF.name,
            hash: VAULT_KDF.hash,
            salt: toBase64(params.saltBytes),
            iterations: params.iterations,
          },
          cipher: {
            name: VAULT_CIPHER.name,
            iv: toBase64(iv),
            data: toBase64(cipher),
          },
        },
      };
    } catch (error) {
      if (keyMaterial) zeroize(keyMaterial);
      throw error;
    }
  };

  const encryptWithDerivedKey = async (params: {
    keyMaterial: Uint8Array;
    secret: Uint8Array;
    base: VaultEnvelope;
  }): Promise<VaultEnvelope> => {
    const { cipher, iv } = await aesGcmEncrypt(params.keyMaterial, params.secret, resolved.ivBytes);
    return {
      version: VAULT_VERSION,
      kdf: { ...params.base.kdf },
      cipher: {
        name: VAULT_CIPHER.name,
        iv: toBase64(iv),
        data: toBase64(cipher),
      },
    };
  };

  return {
    async initialize(params: SealVaultParams): Promise<VaultEnvelope> {
      const saltBytes = randomBytes(resolved.saltBytes);
      const sessionSecret = copyBytes(params.secret);
      let sessionKeyMaterial: Uint8Array | null = null;

      try {
        clearSession();
        const encrypted = await encryptWithPassword({
          password: params.password,
          secret: sessionSecret,
          saltBytes,
          iterations: resolved.iterations,
        });
        sessionKeyMaterial = encrypted.keyMaterial;
        envelope = encrypted.envelope;

        return cloneEnvelope(encrypted.envelope);
      } finally {
        zeroize(sessionSecret);
        if (sessionKeyMaterial) zeroize(sessionKeyMaterial);
      }
    },

    async unlock(params: UnlockVaultParams): Promise<void> {
      const sealed = params.envelope ?? envelope;
      if (!sealed) {
        throw new VaultNotInitializedError();
      }

      clearSession();

      const decoded = decodeEnvelopeOrThrow(sealed);
      try {
        const { keyMaterial, plain } = await decryptWithPassword({ password: params.password, decoded });
        derivedKey = keyMaterial;
        secret = plain;
        envelope = cloneEnvelope(sealed);
      } catch (error) {
        clearSession();
        if (isArxBaseError(error) && error.code === "vault.invalid_ciphertext") {
          throw new VaultInvalidPasswordError();
        }
        throw error;
      }
    },

    lock(): void {
      clearSession();
    },

    exportSecret(): Uint8Array {
      if (!secret || !derivedKey) {
        throw new VaultLockedError();
      }
      return copyBytes(secret);
    },

    async commitSecret(params: CommitSecretParams): Promise<VaultEnvelope> {
      if (!derivedKey || !secret) {
        throw new VaultLockedError();
      }
      const base = envelope;
      if (!base) {
        throw new VaultNotInitializedError();
      }

      let nextSecret: Uint8Array | null = copyBytes(params.secret);
      try {
        const nextEnvelope = await encryptWithDerivedKey({ keyMaterial: derivedKey, secret: nextSecret, base });

        zeroize(secret);
        secret = nextSecret;
        nextSecret = null;
        envelope = nextEnvelope;

        return cloneEnvelope(nextEnvelope);
      } finally {
        if (nextSecret) zeroize(nextSecret);
      }
    },

    async reencrypt(params: ReencryptVaultParams): Promise<VaultEnvelope> {
      const sealed = envelope;
      if (!sealed) throw new VaultNotInitializedError();
      if (!secret || !derivedKey) throw new VaultLockedError();

      let plain: Uint8Array | null = null;

      try {
        const decoded = decodeEnvelopeOrThrow(sealed);
        const saltBytes = (params.rotateSalt ?? true) ? randomBytes(resolved.saltBytes) : decoded.saltBytes;
        const iterations = resolved.iterations;
        plain = copyBytes(secret);

        const encrypted = await encryptWithPassword({
          password: params.newPassword,
          secret: plain,
          saltBytes,
          iterations,
        });

        envelope = encrypted.envelope;

        // Keep the vault unlocked, but rotate the in-memory derived key to match the new password.
        zeroize(derivedKey);
        derivedKey = encrypted.keyMaterial;

        zeroize(secret);
        secret = plain;
        plain = null;

        return cloneEnvelope(envelope);
      } finally {
        if (plain) zeroize(plain);
      }
    },

    importEnvelope(value: VaultEnvelope): void {
      // Validate on import so callers fail fast before persisting.
      decodeEnvelopeOrThrow(value);
      clearSession();
      envelope = cloneEnvelope(value);
    },

    async verifyPassword(password: string): Promise<void> {
      const sealed = envelope;
      if (!sealed) throw new VaultNotInitializedError();

      const decoded = decodeEnvelopeOrThrow(sealed);
      let keyMaterial: Uint8Array | null = null;
      let plain: Uint8Array | null = null;
      try {
        const opened = await decryptWithPassword({ password, decoded });
        keyMaterial = opened.keyMaterial;
        plain = opened.plain;
      } catch (error) {
        if (isArxBaseError(error) && error.code === "vault.invalid_ciphertext") {
          throw new VaultInvalidPasswordError();
        }
        throw error;
      } finally {
        if (plain) zeroize(plain);
        if (keyMaterial) zeroize(keyMaterial);
      }
    },

    getEnvelope(): VaultEnvelope | null {
      return envelope ? cloneEnvelope(envelope) : null;
    },

    getStatus(): VaultStatus {
      const hasEnvelope = envelope !== null;
      const hasSecret = secret !== null;
      const hasDerivedKey = derivedKey !== null;

      if (hasSecret || hasDerivedKey) {
        if (!hasEnvelope || !hasSecret || !hasDerivedKey) {
          throw new VaultInvariantViolationError({
            invariant: "unlocked_requires_envelope_secret_and_derived_key",
          });
        }
        return { status: "unlocked" };
      }

      if (hasEnvelope) {
        return { status: "locked" };
      }

      return {
        status: "uninitialized",
      };
    },
  };
};
