import { add0x, getChecksumAddress, type Hex, isValidHexAddress } from "@metamask/utils";
import { assertNamespace } from "../caip.js";
import { chainErrors } from "../errors.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  ChainAddressModule,
  FormatAddressParams,
} from "../types.js";

const HEX_ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/i;

const with0xPrefix = (value: string): Hex => (value.startsWith("0x") ? (value as Hex) : `0x${value}`);

const toCanonical = (value: string): Hex => with0xPrefix(value).toLowerCase() as Hex;

const fail = (where: "input" | "canonical", value: string) => {
  throw chainErrors.invalidAddress("eip155", { where, value });
};

const assertValidInput = (value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("input", String(value));
  }
  if (!HEX_ADDRESS_PATTERN.test(value.trim())) {
    fail("input", value);
  }
};

const validateCanonical = (canonical: Hex): void => {
  if (!isValidHexAddress(canonical)) {
    fail("canonical", canonical);
  }
};

export const createEip155AddressModule = (): ChainAddressModule => ({
  canonicalize({ chainRef, value }: CanonicalizeAddressParams): CanonicalizedAddressResult {
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
