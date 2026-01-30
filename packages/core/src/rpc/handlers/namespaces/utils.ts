import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { ChainRef } from "../../../chains/ids.js";
import type { Eip155TransactionPayload, TransactionRequest } from "../../../controllers/index.js";
import type { HandlerControllers, Namespace, RpcInvocationContext } from "../types.js";

export const EIP155_NAMESPACE = "eip155";

const randomUuid = (): string => {
  const cryptoRef = globalThis.crypto as undefined | { randomUUID?: () => string; getRandomValues?: (arr: Uint8Array) => void };
  const id = cryptoRef?.randomUUID?.();
  if (id) return id;

  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 v4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
};

export const createTaskId = (_prefix: string) => {
  // Store-first approvals require UUID ids (ApprovalRecord.id).
  return randomUuid();
};

export const isRpcError = (value: unknown): value is { code: number } =>
  Boolean(value && typeof value === "object" && "code" in (value as Record<string, unknown>));

export const isDomainError = isArxError;

/**
 * Extract namespace from RPC invocation context.
 * Priority: explicit namespace → chainRef prefix → undefined
 */
export const namespaceFromContext = (context?: RpcInvocationContext | null): Namespace | undefined => {
  if (!context) return undefined;
  if (context.namespace) return context.namespace;
  if (context.chainRef) {
    const [candidate] = context.chainRef.split(":");
    return candidate as Namespace | undefined;
  }
  return undefined;
};

export const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const toParamsArray = (params: unknown): readonly unknown[] => {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
};

export const deriveSigningInputs = (params: readonly unknown[]) => {
  const address = params.find((value): value is string => typeof value === "string" && HEX_ADDRESS_PATTERN.test(value));
  const message = params.find((value): value is string => typeof value === "string" && (!address || value !== address));
  return { address, message };
};

export const parseTypedDataParams = (params: readonly unknown[]) => {
  let address: string | undefined;
  let payload: unknown;

  for (const value of params) {
    if (!address && typeof value === "string" && HEX_ADDRESS_PATTERN.test(value)) {
      address = value;
      continue;
    }

    if (payload === undefined) {
      payload = value;
    }
  }

  if (!address || payload === undefined) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "eth_signTypedData_v4 expects an address and typed data payload",
      data: { params },
    });
  }

  if (typeof payload === "string") {
    return { address, typedData: payload };
  }

  try {
    return { address, typedData: JSON.stringify(payload) };
  } catch (error) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Failed to serialise typed data payload",
      data: { params, error: error instanceof Error ? error.message : String(error) },
      cause: error,
    });
  }
};

export const buildEip155TransactionRequest = (
  params: readonly unknown[],
  chainRef: ChainRef,
): TransactionRequest<"eip155"> => {
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

  const payload: Eip155TransactionPayload = {
    from: tx.from,
  };

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
