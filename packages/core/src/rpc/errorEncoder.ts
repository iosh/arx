import type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter } from "@arx/errors";
import {
  type ArxError,
  ArxReasons,
  arxError,
  coerceArxError,
  encodeDappError as encodeGenericDappError,
  encodeUiError as encodeGenericUiError,
} from "@arx/errors";

export type RpcSurfaceErrorContext = Omit<ErrorEncodeContext, "surface" | "namespace"> & {
  surface: ErrorSurface;
  namespace?: string | null;
};

export type RpcEncodedExecutionResult<T> = { ok: true; result: T } | { ok: false; error: unknown };

type ProtocolAdapterLookup = {
  getNamespaceProtocolAdapter(namespace: string): NamespaceProtocolAdapter;
};

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: unknown; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};

const toInternalArxError = (error: unknown, ctx: RpcSurfaceErrorContext): ArxError => {
  const message =
    error instanceof Error && typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "Internal error";

  return arxError({
    reason: ArxReasons.RpcInternal,
    message,
    data: {
      namespace: ctx.namespace,
      ...(ctx.chainRef ? { chainRef: ctx.chainRef } : {}),
      ...(ctx.method ? { method: ctx.method } : {}),
    },
    cause: error,
  });
};

const toGenericEncodeContext = (ctx: RpcSurfaceErrorContext): ErrorEncodeContext => {
  return {
    surface: ctx.surface,
    namespace: typeof ctx.namespace === "string" && ctx.namespace.length > 0 ? ctx.namespace : "unknown",
    ...(ctx.chainRef ? { chainRef: ctx.chainRef } : {}),
    ...(ctx.origin ? { origin: ctx.origin } : {}),
    ...(ctx.method ? { method: ctx.method } : {}),
  };
};

export const createRpcErrorEncoder = (lookup: ProtocolAdapterLookup) => {
  const encodeSurfaceError = (error: unknown, ctx: RpcSurfaceErrorContext): unknown => {
    if (ctx.surface === "dapp" && isJsonRpcErrorLike(error)) {
      const message = typeof error.message === "string" && error.message.length > 0 ? error.message : "Unknown error";
      return {
        code: error.code,
        message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      };
    }

    const domain = coerceArxError(error) ?? toInternalArxError(error, ctx);
    const genericContext = toGenericEncodeContext(ctx);

    if (!ctx.namespace) {
      return ctx.surface === "ui"
        ? encodeGenericUiError(domain, genericContext)
        : encodeGenericDappError(domain, genericContext);
    }

    try {
      const adapterContext: ErrorEncodeContext = { ...genericContext, namespace: ctx.namespace };
      const adapter = lookup.getNamespaceProtocolAdapter(ctx.namespace);
      if (ctx.surface === "ui") {
        return adapter.encodeUiError(domain, adapterContext);
      }
      return adapter.encodeDappError(domain, adapterContext);
    } catch {
      return ctx.surface === "ui"
        ? encodeGenericUiError(domain, genericContext)
        : encodeGenericDappError(domain, genericContext);
    }
  };

  const executeWithEncoding = async <T>(
    ctx: RpcSurfaceErrorContext,
    handler: () => Promise<T>,
  ): Promise<RpcEncodedExecutionResult<T>> => {
    try {
      return { ok: true, result: await handler() };
    } catch (error) {
      return { ok: false, error: encodeSurfaceError(error, ctx) };
    }
  };

  return {
    encodeSurfaceError,
    executeWithEncoding,
    encodeDapp: (error: unknown, ctx: Omit<RpcSurfaceErrorContext, "surface">) =>
      encodeSurfaceError(error, { ...ctx, surface: "dapp" }),
    encodeUi: (error: unknown, ctx: Omit<RpcSurfaceErrorContext, "surface">) =>
      encodeSurfaceError(error, { ...ctx, surface: "ui" }),
  };
};

export type RpcErrorEncoder = ReturnType<typeof createRpcErrorEncoder>;
