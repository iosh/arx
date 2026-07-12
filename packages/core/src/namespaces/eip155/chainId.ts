import { assertNamespace, parseChainRef } from "../../chains/caip.js";
import { ChainInvalidRefError } from "../../chains/errors.js";
import type { ChainRef } from "../../chains/ids.js";

const EIP155_DECIMAL_REFERENCE_PATTERN = /^[0-9]+$/;

export const chainRefFromChainId = (chainId: bigint): ChainRef => {
  if (chainId < 0n) throw new ChainInvalidRefError("reference");
  return `eip155:${chainId.toString(10)}`;
};

export const chainIdFromChainRef = (chainRef: ChainRef): bigint => {
  assertNamespace(chainRef, "eip155");
  const { reference } = parseChainRef(chainRef);
  if (!EIP155_DECIMAL_REFERENCE_PATTERN.test(reference)) {
    throw new ChainInvalidRefError("reference");
  }

  return BigInt(reference);
};
