import { splitChainRef } from "../../networks/chainRef.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { Eip155InvalidChainIdError } from "./errors.js";

export type Eip155ChainRef = `${typeof EIP155_NAMESPACE}:${string}`;

// Ox's legacy serialization evaluates chainId * 2 + 35 + v - 27 with v up to 28 using numbers.
export const MAX_EIP155_CHAIN_ID = (BigInt(Number.MAX_SAFE_INTEGER) - 63n) / 2n;

export const isSupportedEip155ChainId = (chainId: bigint): boolean => chainId >= 1n && chainId <= MAX_EIP155_CHAIN_ID;

export const assertEip155ChainId = (chainId: bigint): void => {
  if (!isSupportedEip155ChainId(chainId)) {
    throw new Eip155InvalidChainIdError({ value: `${chainId}` });
  }
};

export const chainRefFromChainId = (chainId: bigint): Eip155ChainRef => {
  assertEip155ChainId(chainId);
  return `${EIP155_NAMESPACE}:${chainId}`;
};

/** Reads a chain ID from an already validated EIP-155 chain reference. */
export const chainIdFromChainRef = (chainRef: Eip155ChainRef): bigint => {
  const { reference } = splitChainRef(chainRef);
  return BigInt(reference);
};
