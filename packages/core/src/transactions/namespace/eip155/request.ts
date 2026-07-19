import * as Hex from "ox/Hex";
import type { ChainRef } from "../../../networks/chainRef.js";
import { parseChainRef } from "../../../networks/chainRef.js";
import type { Eip155TransactionRequest, WalletTransactionRequest } from "../../types.js";
import { Eip155ChainRefError } from "./errors.js";
import type { Eip155TransactionPayload } from "./transactionTypes.js";

export const eip155Request = (
  input: Eip155TransactionPayload,
): WalletTransactionRequest<"eip155", Eip155TransactionPayload> => ({
  namespace: "eip155",
  payload: { ...input },
});

export const deriveEip155HexChainIdFromChainRef = (chainRef: ChainRef): `0x${string}` => {
  const parsed = parseChainRef(chainRef);
  if (parsed.namespace !== "eip155" || !/^\d+$/.test(parsed.reference)) {
    throw new Eip155ChainRefError(chainRef);
  }
  return Hex.fromNumber(BigInt(parsed.reference)) as `0x${string}`;
};

export const deriveEip155TransactionRequestForChain = (
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
