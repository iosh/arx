import { type ChainRef, parseChainRef } from "../../networks/chainRef.js";
import { ChainNamespaceMismatchError } from "../../networks/errors.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { Eip155InvalidChainIdError } from "./errors.js";

const EIP155_DECIMAL_REFERENCE_PATTERN = /^(0|[1-9][0-9]*)$/;

export const validateEip155ChainReference = (reference: string): void => {
  if (!EIP155_DECIMAL_REFERENCE_PATTERN.test(reference)) {
    throw new Eip155InvalidChainIdError({ value: reference, reason: "non_canonical" });
  }
  if (reference.length > 32) {
    throw new Eip155InvalidChainIdError({ value: reference, reason: "too_long" });
  }
};

export const chainRefFromChainId = (chainId: bigint): ChainRef => {
  if (chainId < 0n) {
    throw new Eip155InvalidChainIdError({ value: chainId.toString(10), reason: "negative" });
  }

  const reference = chainId.toString(10);
  validateEip155ChainReference(reference);
  return `${EIP155_NAMESPACE}:${reference}`;
};

export const chainIdFromChainRef = (chainRef: ChainRef): bigint => {
  const parsed = parseChainRef(chainRef);
  if (parsed.namespace !== EIP155_NAMESPACE) {
    throw new ChainNamespaceMismatchError({
      chainRef,
      expectedNamespace: EIP155_NAMESPACE,
      actualNamespace: parsed.namespace,
    });
  }

  validateEip155ChainReference(parsed.reference);
  return BigInt(parsed.reference);
};
