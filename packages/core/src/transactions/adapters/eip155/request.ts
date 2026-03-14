import * as Hex from "ox/Hex";
import { parseChainRef } from "../../../chains/caip.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { Eip155TransactionRequest } from "../../types.js";

export const deriveEip155HexChainIdFromChainRef = (chainRef: ChainRef): `0x${string}` => {
  const parsed = parseChainRef(chainRef);
  if (parsed.namespace !== "eip155" || !/^\d+$/.test(parsed.reference)) {
    throw new Error(`Cannot derive eip155 chainId from chainRef "${chainRef}"`);
  }
  return Hex.fromNumber(BigInt(parsed.reference)) as `0x${string}`;
};

export const normalizeEip155TransactionRequest = (
  request: Eip155TransactionRequest,
  chainRef: ChainRef,
): Eip155TransactionRequest => {
  const payload = { ...request.payload };
  const chainId =
    typeof payload.chainId === "string" && payload.chainId.startsWith("0x")
      ? payload.chainId
      : deriveEip155HexChainIdFromChainRef(chainRef);

  return {
    ...request,
    chainRef,
    payload: {
      ...payload,
      chainId,
    },
  };
};
