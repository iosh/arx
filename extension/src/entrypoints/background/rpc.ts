import type { Json, JsonRpcError, ProviderErrorFactory, RpcErrorFactory, RpcInvocationContext } from "@arx/core";
import type { TransportMeta } from "@arx/provider/types";
import type { PortContext } from "./types";

export type ProviderErrorResolver = (context?: RpcInvocationContext) => ProviderErrorFactory;
export type RpcErrorResolver = (context?: RpcInvocationContext) => RpcErrorFactory;

export type ExtendedRpcContext = RpcInvocationContext & {
  meta: TransportMeta | null;
  errors: {
    provider: ProviderErrorFactory;
    rpc: RpcErrorFactory;
  };
};

export const buildRpcContext = (
  portContext: PortContext | undefined,
  chainRef: string | null,
  resolveProviderErrors: ProviderErrorResolver,
  resolveRpcErrors: RpcErrorResolver,
): ExtendedRpcContext | undefined => {
  if (!portContext) return undefined;
  const namespace = portContext.namespace;
  const resolvedChainRef = chainRef ?? portContext.caip2 ?? null;
  const baseContext: RpcInvocationContext = { namespace, chainRef: resolvedChainRef };
  return {
    ...baseContext,
    meta: portContext.meta,
    errors: {
      provider: resolveProviderErrors(baseContext),
      rpc: resolveRpcErrors(baseContext),
    },
  };
};

export const toJsonRpcError = (
  error: unknown,
  method: string,
  rpcContext: RpcInvocationContext | undefined,
  resolveRpcErrors: RpcErrorResolver,
): JsonRpcError => {
  if (
    error &&
    typeof error === "object" &&
    "serialize" in error &&
    typeof (error as { serialize?: unknown }).serialize === "function"
  ) {
    return (error as { serialize: () => JsonRpcError }).serialize();
  }

  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number") {
    const rpcError = error as { code: number; message?: string; data?: Json };
    return {
      code: rpcError.code,
      message: rpcError.message ?? "Unknown error",
      ...(rpcError.data !== undefined &&
        rpcError.data !== null && {
          data: rpcError.data,
        }),
    };
  }

  return resolveRpcErrors(rpcContext)
    .internal({
      message: `Unexpected error while handling ${method}`,
      data: { method },
    })
    .serialize();
};
