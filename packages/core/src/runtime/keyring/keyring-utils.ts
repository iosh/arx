import { VaultKeyringPayloadSchema } from "../../storage/keyringSchemas.js";
import { zeroize } from "../../vault/utils.js";
import type { Payload } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Encode payload to bytes for vault storage
export const encodePayload = (payload: Payload): Uint8Array => encoder.encode(JSON.stringify(payload));

// Decode and validate payload from vault bytes, auto-zeroize input
export const decodePayload = (bytes: Uint8Array | null, logger?: (m: string, e?: unknown) => void): Payload => {
  if (!bytes || bytes.length === 0) return { keyrings: [] };
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
    return VaultKeyringPayloadSchema.parse(parsed);
  } catch (error) {
    logger?.("keyring: failed to decode vault payload", error);
    return { keyrings: [] };
  } finally {
    if (bytes) zeroize(bytes);
  }
};
