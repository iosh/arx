import type { ErrorEncodeContext, ErrorSurface, NamespaceProtocolAdapter } from "@arx/errors";
import {
  type ArxError,
  ArxReasons,
  arxError,
  coerceArxError,
  encodeDappError as encodeGenericDappError,
  encodeUiError as encodeGenericUiError,
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

const toInternalArxError = (error: unknown, ctx: SurfaceErrorContext): ArxError => {
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
