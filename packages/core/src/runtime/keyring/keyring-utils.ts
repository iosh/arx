import { KeyringInvalidVaultPayloadError } from "../../keyring/errors.js";
import type { Payload } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Encode payload to bytes for vault storage
export const encodePayload = (payload: Payload): Uint8Array => encoder.encode(JSON.stringify(payload));

const invalidPayload = (reason: string, cause?: unknown): never => {
  throw new KeyringInvalidVaultPayloadError({
    details: { path: "$", reason },
    cause,
  });
};

const parseJsonPayload = (bytes: Uint8Array): Payload => {
  try {
    return JSON.parse(decoder.decode(bytes)) as Payload;
  } catch (error) {
    return invalidPayload("Payload is not valid JSON.", error);
  }
};

// Decode payload from vault bytes (pure). Shape is an internal durable contract.
export const decodePayload = (bytes: Uint8Array, logger?: (m: string, e?: unknown) => void): Payload => {
  try {
    if (bytes.length === 0) {
      invalidPayload("Payload bytes are empty.");
    }

    return parseJsonPayload(bytes);
  } catch (error) {
    logger?.("keyring: failed to decode vault payload", error);
    throw error;
  }
};
