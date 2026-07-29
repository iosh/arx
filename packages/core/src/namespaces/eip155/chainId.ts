import { type ChainRef, parseChainRef } from "../../networks/chainRef.js";
import { ChainNamespaceMismatchError } from "../../networks/errors.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { Eip155InvalidChainIdError } from "./errors.js";

const EIP155_DECIMAL_REFERENCE_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_EIP155_CHAIN_ID = 10n ** 32n - 1n;

export const validateEip155ChainReference = (reference: string): void => {
  if (!EIP155_DECIMAL_REFERENCE_PATTERN.test(reference)) {
    throw new Eip155InvalidChainIdError({ value: reference, reason: "non_canonical" });
  }

  const chainId = BigInt(reference);
  if (chainId < 1n || chainId > MAX_EIP155_CHAIN_ID) {
    throw new Eip155InvalidChainIdError({ value: reference, reason: "out_of_range" });
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
