import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type { Namespace, RpcInvocationContext } from "../types.js";

export const EIP155_NAMESPACE = "eip155";

export const createApprovalId = (_prefix: string) => {
  return globalThis.crypto.randomUUID();
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
  if (context.namespace) {
    // Normalize "eip155:1" -> "eip155" so call sites don't need to care.
    const [candidate] = context.namespace.split(":");
    return (candidate || context.namespace) as Namespace;
  }
  if (context.chainRef) {
    const [candidate] = context.chainRef.split(":");
    return candidate as Namespace | undefined;
  }
  if (context.providerNamespace) {
    const [candidate] = context.providerNamespace.split(":");
    return (candidate || context.providerNamespace) as Namespace;
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
