import { KeyringInvalidVaultPayloadError } from "../errors.js";
import type { Payload } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Encode payload to bytes for vault storage
export const encodePayload = (payload: Payload): Uint8Array => encoder.encode(JSON.stringify(payload));

const invalidPayload = (reason: string): never => {
  throw new KeyringInvalidVaultPayloadError({ path: "$", reason });
};

const parseJsonPayload = (bytes: Uint8Array): Payload => {
  try {
    return JSON.parse(decoder.decode(bytes)) as Payload;
  } catch {
    return invalidPayload("Payload is not valid JSON.");
  }
};

export const decodePayload = (bytes: Uint8Array): Payload => {
  if (bytes.length === 0) {
    invalidPayload("Payload bytes are empty.");
  }

  return parseJsonPayload(bytes);
};
