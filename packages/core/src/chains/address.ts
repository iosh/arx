import * as Address from "ox/Address";
import { keyringErrors } from "../errors/keyring.js";
// Canonical lower-case EVM/eSpace address normalizer
export const normalizeEvmAddress = (value: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw keyringErrors.invalidAddress();
  }
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  const lower = withPrefix.toLowerCase();
  try {
    Address.assert(lower, { strict: false });
  } catch {
    throw keyringErrors.invalidAddress();
  }
  return lower;
};

// TODO: add other normalizers
export type AddressNormalizer = (value: string) => string;
