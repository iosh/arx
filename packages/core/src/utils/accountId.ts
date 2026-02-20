import { toCanonicalEvmAddress } from "../chains/address.js";

/**
 * Minimal helpers for the current CAIP-10-like account id convention:
 * - `eip155:<hex40>`
 * This is intentionally narrow (EIP-155 only) until multi-namespace account ids land.
 */

export const toEip155AccountIdFromCanonicalAddress = (canonicalAddress: string): string => {
  const trimmed = canonicalAddress.trim();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return `eip155:${normalized.toLowerCase()}`;
};

export const toEip155AccountIdFromAddress = (address: string): string => {
  const canonical = toCanonicalEvmAddress(address);
  return toEip155AccountIdFromCanonicalAddress(canonical);
};

export const toEip155AddressFromAccountId = (accountId: string): string => {
  const trimmed = accountId.trim().toLowerCase();
  const match = /^eip155:([0-9a-f]{40})$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid eip155 accountId: "${accountId}"`);
  }
  return `0x${match[1]}`;
};
