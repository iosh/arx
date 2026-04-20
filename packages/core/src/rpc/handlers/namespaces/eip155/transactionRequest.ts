import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../../chains/ids.js";
import type {
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  TransactionRequest,
} from "../../../../transactions/types.js";

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const buildEip155TransactionRequest = (
  params: readonly unknown[],
  chainRef: ChainRef,
): TransactionRequest<"eip155"> & { payload: Eip155TransactionPayloadWithFrom } => {
  const [raw] = params;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "eth_sendTransaction expects params[0] to be a transaction object",
      data: { params },
    });
  }

  const tx = raw as Record<string, unknown>;

  if (typeof tx.from !== "string" || !HEX_ADDRESS_PATTERN.test(tx.from)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "eth_sendTransaction requires a valid from address",
      data: { params },
    });
  }

  const payload: Eip155TransactionPayloadWithFrom = { from: tx.from };

  if (tx.to !== undefined) {
    if (tx.to === null || (typeof tx.to === "string" && tx.to.startsWith("0x"))) {
      payload.to = tx.to as string | null;
    } else {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction 'to' must be null or a 0x-prefixed string",
        data: { params },
      });
    }
  }

  const hexKeys: (keyof Omit<Eip155TransactionPayload, "from" | "to">)[] = [
    "chainId",
    "value",
    "data",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
  ];

  for (const key of hexKeys) {
    const value = tx[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.startsWith("0x")) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: `Transaction '${key}' must be a 0x-prefixed string`,
        data: { params },
      });
    }
    payload[key] = value as `0x${string}`;
  }

  return {
    namespace: "eip155",
    chainRef,
    payload,
  };
};
