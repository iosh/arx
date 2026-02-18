import { createEip155AddressModule } from "./eip155/address.js";

const eip155 = createEip155AddressModule();
/**
 * EVM/eSpace canonical form: 0x + 40 hex lower-case.
 */
export const toCanonicalEvmAddress = (value: string): string => {
  return eip155.canonicalize({ chainRef: "eip155:1", value }).canonical;
};

// TODO: add other normalizers
export type AddressNormalizer = (value: string) => string;
