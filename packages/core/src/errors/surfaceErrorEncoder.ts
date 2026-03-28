import type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter } from "@arx/errors";
import {
  type ArxError,
  ArxReasons,
  arxError,
  coerceArxError,
  encodeDappError as encodeGenericDappError,
  encodeUiError as encodeGenericUiError,
  sanitizeJsonRpcErrorObject,
} from "@arx/errors";

export type SurfaceErrorContext = Omit<ErrorEncodeContext, "surface" | "namespace"> & {
  surface: ErrorSurface;
  namespace?: string | null;
};

export type EncodedSurfaceExecutionResult<T> = { ok: true; result: T } | { ok: false; error: unknown };

type SurfaceProtocolAdapterLookup = {
  getNamespaceProtocolAdapter(namespace: string): NamespaceProtocolAdapter;
};

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: unknown; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number";
};

const buildFallbackErrorData = (ctx: SurfaceErrorContext) => {
  const data = {
    ...(typeof ctx.namespace === "string" && ctx.namespace.length > 0 ? { namespace: ctx.namespace } : {}),
    ...(ctx.chainRef ? { chainRef: ctx.chainRef } : {}),
    ...(ctx.method ? { method: ctx.method } : {}),
  };

  return Object.keys(data).length > 0 ? data : undefined;
};

const toRpcInternalFallbackError = (error: unknown, ctx: SurfaceErrorContext): ArxError => {
  const data = buildFallbackErrorData(ctx);

  return arxError({
    reason: ArxReasons.RpcInternal,
    message: "Internal error",
    ...(data ? { data } : {}),
    cause: error,
  });
};

const toGenericEncodeContext = (ctx: SurfaceErrorContext): ErrorEncodeContext => {
  return {
    surface: ctx.surface,
    namespace: typeof ctx.namespace === "string" && ctx.namespace.length > 0 ? ctx.namespace : "unknown",
    ...(ctx.chainRef ? { chainRef: ctx.chainRef } : {}),
    ...(ctx.origin ? { origin: ctx.origin } : {}),
    ...(ctx.method ? { method: ctx.method } : {}),
  };
};

export const createSurfaceErrorEncoder = (lookup: SurfaceProtocolAdapterLookup) => {
  const encodeSurfaceError = (error: unknown, ctx: SurfaceErrorContext): unknown => {
    if (ctx.surface === "dapp" && isJsonRpcErrorLike(error)) {
      return sanitizeJsonRpcErrorObject(error);
    }

    const domain = coerceArxError(error) ?? toRpcInternalFallbackError(error, ctx);
    const genericContext = toGenericEncodeContext(ctx);

    if (ctx.surface === "ui") {
      return encodeGenericUiError(domain, genericContext);
    }

    if (!ctx.namespace) {
      return encodeGenericDappError(domain, genericContext);
    }

    try {
      const adapterContext: ErrorEncodeContext = { ...genericContext, namespace: ctx.namespace };
      const adapter = lookup.getNamespaceProtocolAdapter(ctx.namespace);
      return adapter.encodeDappError(domain, adapterContext);
    } catch {
      return encodeGenericDappError(domain, genericContext);
    }
  };

  const executeWithEncoding = async <T>(
    ctx: SurfaceErrorContext,
    handler: () => Promise<T>,
  ): Promise<EncodedSurfaceExecutionResult<T>> => {
    try {
      return { ok: true, result: await handler() };
    } catch (error) {
      return { ok: false, error: encodeSurfaceError(error, ctx) };
    }
  };

  return {
    encodeSurfaceError,
    executeWithEncoding,
    encodeDapp: (error: unknown, ctx: Omit<SurfaceErrorContext, "surface">) =>
      encodeSurfaceError(error, { ...ctx, surface: "dapp" }),
    encodeUi: (error: unknown, ctx: Omit<SurfaceErrorContext, "surface">) =>
      encodeSurfaceError(error, { ...ctx, surface: "ui" }),
  };
};

export type SurfaceErrorEncoder = ReturnType<typeof createSurfaceErrorEncoder>;
