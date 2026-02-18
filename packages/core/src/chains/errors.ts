import { ArxReasons, arxError } from "@arx/errors";

export const chainErrors = {
  invalidChainRef: (value: unknown, data?: Record<string, unknown>) =>
    arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: `Invalid CAIP-2 chainRef: ${typeof value === "string" ? value : String(value)}`,
      data: { value, ...(data ?? {}) },
    }),

  namespaceMismatch: (params: { chainRef: string; expected: string; actual: string }) =>
    arxError({
      reason: ArxReasons.ChainNotCompatible,
      message: `Chain ${params.chainRef} does not belong to namespace "${params.expected}"`,
      data: params,
    }),

  namespaceNotSupported: (params: { chainRef: string; namespace: string }) =>
    arxError({
      reason: ArxReasons.ChainNotSupported,
      message: `No chain descriptor registered for "${params.chainRef}"`,
      data: params,
    }),

  invalidAddress: (namespace: string, data?: Record<string, unknown>) =>
    arxError({
      reason: ArxReasons.ChainInvalidAddress,
      message: `Invalid ${namespace} address`,
      ...(data ? { data } : {}),
    }),
};
