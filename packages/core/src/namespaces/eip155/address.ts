import { Address, type Hex } from "ox";
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

const with0xPrefix = (value: string): Hex.Hex => (value.startsWith("0x") ? (value as Hex.Hex) : `0x${value}`);

const toCanonicalAddress = (value: string): Hex.Hex => with0xPrefix(value).toLowerCase() as Hex.Hex;

export const isEip155Address = (value: string): boolean => Address.validate(with0xPrefix(value), { strict: false });

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
  if (!isEip155Address(value.trim())) {
    fail("input");
  }
};

const validateCanonical = (canonical: Hex.Hex): void => {
  if (!Address.validate(canonical, { strict: false })) {
    fail("canonical");
  }
};

export const createEip155AddressFormat = (): ChainAddressFormat => ({
  canonicalize({ chainRef, value }: CanonicalizeAddressParams): CanonicalizedAddressResult {
    assertEip155ChainRef(chainRef);
    assertValidInput(value);
    const canonical = toCanonicalAddress(value.trim());
    validateCanonical(canonical);
    return { canonical };
  },

  format({ chainRef, canonical }: FormatAddressParams): string {
    assertEip155ChainRef(chainRef);
    const canonicalAddress = toCanonicalAddress(canonical.trim());
    validateCanonical(canonicalAddress);
    return Address.checksum(canonicalAddress);
  },

  validate({ chainRef, canonical }: FormatAddressParams): void {
    assertEip155ChainRef(chainRef);
    validateCanonical(toCanonicalAddress(canonical.trim()));
  },
});
