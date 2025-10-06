import { vaultErrors } from "../errors/vault.js";

const KEY_LENGTH_BITS = 256;

const cryptoApi = (() => {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto !== null) {
    return globalThis.crypto as Crypto;
  }
  throw new Error("Web Crypto API is not available in this runtime");
})();

const encoder = new TextEncoder();

const toArrayBuffer = (view: Uint8Array): ArrayBuffer => {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.slice().buffer as ArrayBuffer;
};

export const randomBytes = (size: number): Uint8Array => {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Random byte length must be a positive integer");
  }
  const buffer = new Uint8Array(size);
  cryptoApi.getRandomValues(buffer);
  return buffer;
};

export const copyBytes = (input: Uint8Array): Uint8Array => new Uint8Array(input);

export const zeroize = (buffer: Uint8Array): void => {
  buffer.fill(0);
};

export const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }
  throw new Error("Base64 encoder is not available");
};

export const fromBase64 = (value: string): Uint8Array => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  }
  throw new Error("Base64 decoder is not available");
};

export const importPasswordKey = (password: string): Promise<CryptoKey> => {
  if (password.trim().length === 0) {
    throw vaultErrors.invalidPassword();
  }
  return cryptoApi.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
};

export const deriveKeyMaterial = async (
  passwordKey: CryptoKey,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const buffer = await cryptoApi.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    passwordKey,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(buffer);
};

const importAesKey = (keyMaterial: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> => {
  return cryptoApi.subtle.importKey("raw", toArrayBuffer(keyMaterial), "AES-GCM", false, usages);
};

export const aesGcmEncrypt = async (
  keyMaterial: Uint8Array,
  plaintext: Uint8Array,
  ivLength: number,
): Promise<{ cipher: Uint8Array; iv: Uint8Array }> => {
  const iv = randomBytes(ivLength);
  const cryptoKey = await importAesKey(keyMaterial, ["encrypt"]);
  const encrypted = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(plaintext),
  );
  return { cipher: new Uint8Array(encrypted), iv };
};

export const aesGcmDecrypt = async (
  keyMaterial: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> => {
  const cryptoKey = await importAesKey(keyMaterial, ["decrypt"]);
  const decrypted = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(decrypted);
};
