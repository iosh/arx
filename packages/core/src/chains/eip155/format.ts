import * as Hex from "../../utils/hex.js";
import { assertNamespace, parseChainRef } from "../caip.js";
import { ChainInvalidRefError } from "../errors.js";
import type { ChainRef } from "../ids.js";

const EIP155_DECIMAL_REFERENCE_PATTERN = /^[0-9]+$/;

export const eip155ChainRefFromChainIdHex = (value: string): ChainRef => {
  return `eip155:${Hex.toBigInt(value).toString(10)}`;
};

export const eip155ChainIdHexFromChainRef = (chainRef: ChainRef): Hex.Hex => {
  assertNamespace(chainRef, "eip155");
  const { reference } = parseChainRef(chainRef);
  if (!EIP155_DECIMAL_REFERENCE_PATTERN.test(reference)) {
    throw new ChainInvalidRefError("reference");
  }

  return Hex.fromNumber(BigInt(reference));
};
