import { add0x, getChecksumAddress, type Hex, isValidHexAddress } from "@metamask/utils";
import { assertNamespace } from "../caip.js";
import type {
  ChainAddressModule,
  FormatAddressParams,
  NormalizeAddressParams,
  NormalizedAddressResult,
} from "../types.js";

const HEX_ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/i;

const ensurePrefixed = (value: string): Hex => (value.startsWith("0x") ? (value as Hex) : `0x${value}`);

const toCanonical = (value: string): Hex => ensurePrefixed(value).toLowerCase() as Hex;

const assertValidInput = (value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Address must be a non-empty string");
  }
  if (!HEX_ADDRESS_PATTERN.test(value.trim())) {
    throw new Error(`Invalid EIP-155 address: ${value}`);
  }
};

const validateCanonical = (canonical: Hex): void => {
  if (!isValidHexAddress(canonical)) {
    throw new Error(`Invalid canonical EIP-155 address: ${canonical}`);
  }
};

export const createEip155AddressModule = (): ChainAddressModule => ({
  normalize({ chainRef, value }: NormalizeAddressParams): NormalizedAddressResult {
    assertNamespace(chainRef, "eip155");
    assertValidInput(value);
    const canonical = toCanonical(value.trim());
    validateCanonical(canonical);
    return { canonical };
  },

  format({ chainRef, canonical }: FormatAddressParams): string {
    assertNamespace(chainRef, "eip155");
    const normalized = toCanonical(canonical.trim());
    validateCanonical(normalized);
    return getChecksumAddress(add0x(normalized));
  },

  validate({ chainRef, canonical }: FormatAddressParams): void {
    assertNamespace(chainRef, "eip155");
    validateCanonical(toCanonical(canonical.trim()));
  },
});
