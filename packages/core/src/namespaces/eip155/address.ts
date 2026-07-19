import { add0x, getChecksumAddress, type Hex, isValidHexAddress } from "@metamask/utils";
import { ChainInvalidAddressError } from "../../chains/errors.js";
import type {
  CanonicalizeAddressParams,
  CanonicalizedAddressResult,
  ChainAddressFormat,
  FormatAddressParams,
} from "../../chains/types.js";
import { type ChainRef, parseChainRef } from "../../networks/chainRef.js";
import { ChainNamespaceMismatchError } from "../../networks/errors.js";
import { EIP155_NAMESPACE } from "./constants.js";

const HEX_ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/i;

const with0xPrefix = (value: string): Hex => (value.startsWith("0x") ? (value as Hex) : `0x${value}`);

const toCanonical = (value: string): Hex => with0xPrefix(value).toLowerCase() as Hex;

const fail = (field: "input" | "canonical") => {
  throw new ChainInvalidAddressError({ namespace: EIP155_NAMESPACE, field });
};

const assertEip155ChainRef = (chainRef: ChainRef): void => {
  const { namespace } = parseChainRef(chainRef);
  if (namespace !== EIP155_NAMESPACE) {
    throw new ChainNamespaceMismatchError({
      chainRef,
      expectedNamespace: EIP155_NAMESPACE,
      actualNamespace: namespace,
    });
  }
};

const assertValidInput = (value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("input");
  }
  if (!HEX_ADDRESS_PATTERN.test(value.trim())) {
    fail("input");
  }
};

const validateCanonical = (canonical: Hex): void => {
  if (!isValidHexAddress(canonical)) {
    fail("canonical");
  }
};

export const createEip155AddressFormat = (): ChainAddressFormat => ({
  canonicalize({ chainRef, value }: CanonicalizeAddressParams): CanonicalizedAddressResult {
    assertEip155ChainRef(chainRef);
    assertValidInput(value);
    const canonical = toCanonical(value.trim());
    validateCanonical(canonical);
    return { canonical };
  },

  format({ chainRef, canonical }: FormatAddressParams): string {
    assertEip155ChainRef(chainRef);
    const normalized = toCanonical(canonical.trim());
    validateCanonical(normalized);
    return getChecksumAddress(add0x(normalized));
  },

  validate({ chainRef, canonical }: FormatAddressParams): void {
    assertEip155ChainRef(chainRef);
    validateCanonical(toCanonical(canonical.trim()));
  },
});
