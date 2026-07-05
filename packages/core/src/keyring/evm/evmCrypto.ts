import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { KeyringInvalidAddressError, KeyringInvalidPrivateKeyError } from "../errors.js";

const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/;

export function canonicalizeEvmAddress(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KeyringInvalidAddressError();
  }
  const normalized = value.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(normalized)) {
    throw new KeyringInvalidAddressError();
  }
  return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
}

export function parsePrivateKeyBytes(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new KeyringInvalidPrivateKeyError();
    return new Uint8Array(value);
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KeyringInvalidPrivateKeyError();
  }

  const trimmed = value.trim();
  if (!PRIVATE_KEY_PATTERN.test(trimmed)) {
    throw new KeyringInvalidPrivateKeyError();
  }

  const bytes = hexToBytes(trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed);
  if (bytes.length !== 32) {
    throw new KeyringInvalidPrivateKeyError();
  }

  return bytes;
}

export function privateKeyToEvmAddress(secret: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(secret, false);
  const hash = keccak_256(publicKey.subarray(1));
  const addressBytes = hash.slice(hash.length - 20);
  return `0x${bytesToHex(addressBytes)}`;
}
