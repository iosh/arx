import { keyringErrors } from "../keyring/errors.js";
import { createEip155AddressModule } from "./eip155/address.js";

const eip155 = createEip155AddressModule();
// Canonical lower-case EVM/eSpace address normalizer
export const toCanonicalEvmAddress = (value: string): string => {
  try {
    // Reuse the eip155 chain module as the single source of truth.
    return eip155.canonicalize({ chainRef: "eip155:1", value }).canonical;
  } catch {
    throw keyringErrors.invalidAddress();
  }
};

// TODO: add other normalizers
export type AddressNormalizer = (value: string) => string;
