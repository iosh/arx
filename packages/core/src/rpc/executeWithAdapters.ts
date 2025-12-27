import type { ErrorEncodeContext, ErrorSurface, UiErrorPayload } from "@arx/errors";
import { type ArxError, ArxReasons, arxError, isArxError } from "@arx/errors";
import { getNamespaceProtocolAdapter } from "./protocolAdapterRegistry.js";

export type ExecuteWithAdaptersContext = Omit<ErrorEncodeContext, "surface"> & {
  surface: ErrorSurface;
};

export type ExecuteWithAdaptersResult<T> = { ok: true; result: T } | { ok: false; error: unknown };

const isJsonRpcErrorLike = (value: unknown): value is { code: number; message?: string; data?: unknown } => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "number" && typeof candidate.message === "string";
};

const toInternalArxError = (error: unknown, ctx: ExecuteWithAdaptersContext): ArxError => {
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

const encodeUiInternalFallback = (error: ArxError): UiErrorPayload => ({
  reason: error.reason,
  message: error.message,
  ...(error.data !== undefined ? { data: error.data } : {}),
});

const encodeDappInternalFallback = (error: ArxError) => ({
  code: -32603,
  message: error.message || "Internal error",
  ...(error.data !== undefined ? { data: error.data } : {}),
});

export const encodeErrorWithAdapters = (error: unknown, ctx: ExecuteWithAdaptersContext): unknown => {
  if (ctx.surface === "dapp") {
    if (isJsonRpcErrorLike(error)) {
      return {
        code: error.code,
        message: error.message ?? "Unknown error",
        ...(error.data !== undefined ? { data: error.data } : {}),
      };
    }
  }

  const domain = isArxError(error) ? error : toInternalArxError(error, ctx);

  try {
    const adapter = getNamespaceProtocolAdapter(ctx.namespace);
    if (ctx.surface === "ui") {
      return adapter.encodeUiError(domain, ctx);
    }
    return adapter.encodeDappError(domain, ctx);
  } catch (adapterError) {
    const fallback = toInternalArxError(adapterError, ctx);
    return ctx.surface === "ui" ? encodeUiInternalFallback(fallback) : encodeDappInternalFallback(fallback);
  }
};

export const executeWithAdapters = async <T>(
  ctx: ExecuteWithAdaptersContext,
  handler: () => Promise<T>,
): Promise<ExecuteWithAdaptersResult<T>> => {
  try {
    return { ok: true, result: await handler() };
  } catch (error) {
    return { ok: false, error: encodeErrorWithAdapters(error, ctx) };
  }
};
