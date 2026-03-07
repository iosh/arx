import { ArxReasons, arxError } from "@arx/errors";

export const chainErrors = {
  invalidChainRef: (value: unknown, data?: Record<string, unknown>) =>
    arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: `Invalid CAIP-2 chainRef: ${typeof value === "string" ? value : String(value)}`,
      data: { value, ...(data ?? {}) },
    }),

  notFound: (params: { chainRef?: string; chainId?: string }) =>
    arxError({
      reason: ArxReasons.ChainNotFound,
      message: "Requested chain is not registered with ARX",
      data: params,
    }),

  notAvailable: (params: { chainRef: string }) =>
    arxError({
      reason: ArxReasons.ChainNotSupported,
      message: "Requested chain is not available in network runtime",
      data: params,
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
      message: `No chain address codec registered for "${params.chainRef}"`,
      data: params,
    }),

  invalidAddress: (namespace: string, data?: Record<string, unknown>) =>
    arxError({
      reason: ArxReasons.ChainInvalidAddress,
      message: `Invalid ${namespace} address`,
      ...(data ? { data } : {}),
    }),
};
