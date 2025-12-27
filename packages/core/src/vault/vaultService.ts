import { ArxReasons, isArxError } from "@arx/errors";
import { vaultErrors } from "../errors/vault.js";
import type {
  InitializeVaultParams,
  SealVaultParams,
  UnlockVaultParams,
  VaultAlgorithm,
  VaultCiphertext,
  VaultConfig,
  VaultService,
  VaultStatus,
} from "./types.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  copyBytes,
  deriveKeyMaterial,
  fromBase64,
  importPasswordKey,
  randomBytes,
  toBase64,
  zeroize,
} from "./utils.js";

type ResolvedVaultConfig = {
  iterations: number;
  saltBytes: number;
  ivBytes: number;
  secretBytes: number;
};

const DEFAULT_CONFIG: ResolvedVaultConfig = {
  iterations: 600_000,
  saltBytes: 16,
  ivBytes: 12,
  secretBytes: 32,
};

const VAULT_ALGORITHM: VaultAlgorithm = "pbkdf2-sha256";
export const VAULT_VERSION = 1;

const assertPositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
};

const resolveConfig = (config?: VaultConfig): ResolvedVaultConfig => {
  const iterations = config?.iterations ?? DEFAULT_CONFIG.iterations;
  const saltBytes = config?.saltBytes ?? DEFAULT_CONFIG.saltBytes;
  const ivBytes = config?.ivBytes ?? DEFAULT_CONFIG.ivBytes;
  const secretBytes = config?.secretBytes ?? DEFAULT_CONFIG.secretBytes;

  assertPositiveInteger(iterations, "PBKDF2 iteration count");
  assertPositiveInteger(saltBytes, "Salt length");
  assertPositiveInteger(ivBytes, "AES-GCM IV length");
  assertPositiveInteger(secretBytes, "Secret byte length");

  return { iterations, saltBytes, ivBytes, secretBytes };
};

const cloneCiphertext = (ciphertext: VaultCiphertext): VaultCiphertext => ({ ...ciphertext });

export const createVaultService = (config?: VaultConfig): VaultService => {
  const resolved = resolveConfig(config);

  let ciphertext: VaultCiphertext | null = null;
  let derivedKey: Uint8Array | null = null;
  let secret: Uint8Array | null = null;
  let salt: Uint8Array | null = null;
  let iterationCount: number | null = null;

  const clearSession = () => {
    if (derivedKey) {
      zeroize(derivedKey);
      derivedKey = null;
    }
    if (secret) {
      zeroize(secret);
      secret = null;
    }
    salt = null;
    iterationCount = null;
  };

  const parseCiphertext = (value: VaultCiphertext) => {
    if (value.version !== VAULT_VERSION || value.algorithm !== VAULT_ALGORITHM) {
      throw vaultErrors.invalidCiphertext();
    }
    try {
      const decodedSalt = fromBase64(value.salt);
      const decodedIv = fromBase64(value.iv);
      const decodedCipher = fromBase64(value.cipher);
      if (!decodedSalt.length || !decodedIv.length || !decodedCipher.length) {
        throw new Error("Decoded ciphertext is empty");
      }
      return {
        ciphertext: cloneCiphertext(value),
        salt: decodedSalt,
        iterations: value.iterations,
      };
    } catch {
      throw vaultErrors.invalidCiphertext();
    }
  };

  return {
    async initialize(params: InitializeVaultParams): Promise<VaultCiphertext> {
      const passwordKey = await importPasswordKey(params.password);
      clearSession();

      const derivedSalt = randomBytes(resolved.saltBytes);
      const keyMaterial = await deriveKeyMaterial(passwordKey, derivedSalt, resolved.iterations);
      const sessionSecret = params.secret ? copyBytes(params.secret) : randomBytes(resolved.secretBytes);

      salt = derivedSalt;
      iterationCount = resolved.iterations;
      derivedKey = keyMaterial;
      secret = sessionSecret;

      const { cipher, iv } = await aesGcmEncrypt(keyMaterial, sessionSecret, resolved.ivBytes);
      ciphertext = {
        version: VAULT_VERSION,
        algorithm: VAULT_ALGORITHM,
        salt: toBase64(derivedSalt),
        iterations: iterationCount,
        iv: toBase64(iv),
        cipher: toBase64(cipher),
        createdAt: Date.now(),
      };

      return cloneCiphertext(ciphertext);
    },

    async unlock(params: UnlockVaultParams): Promise<Uint8Array> {
      const parsed = params.ciphertext ? parseCiphertext(params.ciphertext) : null;
      const sealed = parsed?.ciphertext ?? ciphertext;
      if (!sealed) {
        throw vaultErrors.notInitialized();
      }

      const saltBytes = parsed?.salt ?? fromBase64(sealed.salt);
      const iterations = parsed?.iterations ?? sealed.iterations;
      clearSession();

      try {
        const passwordKey = await importPasswordKey(params.password);
        const keyMaterial = await deriveKeyMaterial(passwordKey, saltBytes, iterations);
        const plain = await aesGcmDecrypt(keyMaterial, fromBase64(sealed.cipher), fromBase64(sealed.iv));

        derivedKey = keyMaterial;
        secret = plain;
        salt = saltBytes;
        iterationCount = iterations;
        ciphertext = cloneCiphertext(sealed);

        return copyBytes(plain);
      } catch (error) {
        clearSession();
        if (isArxError(error) && error.reason === ArxReasons.VaultInvalidCiphertext) {
          throw vaultErrors.invalidPassword();
        }
        throw error;
      }
    },

    lock(): void {
      clearSession();
    },

    exportKey(): Uint8Array {
      if (!secret || !derivedKey) {
        throw vaultErrors.locked();
      }
      return copyBytes(secret);
    },

    async seal(params: SealVaultParams): Promise<VaultCiphertext> {
      const sealed = ciphertext;
      if (!sealed) {
        throw vaultErrors.notInitialized();
      }

      const saltBytes = salt ?? fromBase64(sealed.salt);
      const iterations = iterationCount ?? sealed.iterations;
      const passwordKey = await importPasswordKey(params.password);
      const keyMaterial = await deriveKeyMaterial(passwordKey, saltBytes, iterations);

      clearSession();

      const secretCopy = copyBytes(params.secret);
      const { cipher, iv } = await aesGcmEncrypt(keyMaterial, secretCopy, resolved.ivBytes);

      derivedKey = keyMaterial;
      secret = secretCopy;
      salt = saltBytes;
      iterationCount = iterations;
      ciphertext = {
        version: VAULT_VERSION,
        algorithm: VAULT_ALGORITHM,
        salt: toBase64(saltBytes),
        iterations,
        iv: toBase64(iv),
        cipher: toBase64(cipher),
        createdAt: Date.now(),
      };

      return cloneCiphertext(ciphertext);
    },

    async reseal(params: { secret: Uint8Array }): Promise<VaultCiphertext> {
      if (!derivedKey || !salt || iterationCount === null) {
        throw vaultErrors.locked();
      }

      const nextSecret = copyBytes(params.secret);
      const { cipher, iv } = await aesGcmEncrypt(derivedKey, nextSecret, resolved.ivBytes);

      if (secret) {
        zeroize(secret);
      }
      secret = nextSecret;
      ciphertext = {
        version: VAULT_VERSION,
        algorithm: VAULT_ALGORITHM,
        salt: toBase64(salt),
        iterations: iterationCount,
        iv: toBase64(iv),
        cipher: toBase64(cipher),
        createdAt: Date.now(),
      };

      return cloneCiphertext(ciphertext);
    },
    importCiphertext(value: VaultCiphertext): void {
      const parsed = parseCiphertext(value);
      clearSession();
      ciphertext = parsed.ciphertext;
      salt = parsed.salt;
      iterationCount = parsed.iterations;
    },

    async verifyPassword(password: string): Promise<void> {
      const sealed = ciphertext;
      if (!sealed) throw vaultErrors.notInitialized();

      const saltBytes = fromBase64(sealed.salt);
      const iterations = sealed.iterations;
      const cipherBytes = fromBase64(sealed.cipher);
      const ivBytes = fromBase64(sealed.iv);
      let keyMaterial: Uint8Array | null = null;
      try {
        const passwordKey = await importPasswordKey(password);
        keyMaterial = await deriveKeyMaterial(passwordKey, saltBytes, iterations);
        await aesGcmDecrypt(keyMaterial, cipherBytes, ivBytes);
      } catch (error) {
        if (isArxError(error) && error.reason === ArxReasons.VaultInvalidCiphertext) {
          throw vaultErrors.invalidPassword();
        }
        throw error;
      } finally {
        if (keyMaterial) zeroize(keyMaterial);
      }
    },
    getCiphertext(): VaultCiphertext | null {
      return ciphertext ? cloneCiphertext(ciphertext) : null;
    },

    getStatus(): VaultStatus {
      return {
        isUnlocked: secret !== null,
        hasCiphertext: ciphertext !== null,
      };
    },

    isUnlocked(): boolean {
      return secret !== null;
    },
  };
};
