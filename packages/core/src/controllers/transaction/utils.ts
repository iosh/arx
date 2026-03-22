import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type {
  TransactionPrepareContext,
  TransactionSignContext,
  TransactionTrackingContext,
} from "../../transactions/adapters/types.js";
import type {
  TransactionError,
  TransactionIssue,
  TransactionMeta,
  TransactionRequest,
  TransactionWarning,
} from "./types.js";

const deepClone = <T>(value: T): T => {
  // Most transaction payloads are JSON-like. Prefer structuredClone when available.
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // Fallback: shallow clone for plain objects/arrays.
    if (Array.isArray(value)) return [...(value as unknown as unknown[])] as T;
    return { ...(value as Record<string, unknown>) } as T;
  }
};

export const cloneRequest = (request: TransactionRequest): TransactionRequest => {
  return {
    ...request,
    payload: deepClone(request.payload),
  };
};

export const cloneWarnings = (list: TransactionWarning[]): TransactionWarning[] =>
  list.map((warning) => ({
    ...warning,
    ...(warning.data !== undefined ? { data: deepClone(warning.data) } : {}),
  }));

export const cloneIssues = (list: TransactionIssue[]): TransactionIssue[] =>
  list.map((issue) => ({
    ...issue,
    ...(issue.data !== undefined ? { data: deepClone(issue.data) } : {}),
  }));

export const cloneMeta = (meta: TransactionMeta): TransactionMeta => ({
  ...meta,
  request: cloneRequest(meta.request),
  prepared: meta.prepared ? deepClone(meta.prepared) : null,
  receipt: meta.receipt ? deepClone(meta.receipt) : null,
  error: meta.error
    ? {
        ...meta.error,
        ...(meta.error.data !== undefined ? { data: deepClone(meta.error.data) } : {}),
      }
    : null,
  warnings: cloneWarnings(meta.warnings),
  issues: cloneIssues(meta.issues),
});

export const mergeWarnings = (base: TransactionWarning[], next: TransactionWarning[]): TransactionWarning[] => {
  const out: TransactionWarning[] = [];
  const seen = new Set<string>();

  for (const item of [...base, ...next]) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
};

export const mergeIssues = (base: TransactionIssue[], next: TransactionIssue[]): TransactionIssue[] => {
  const out: TransactionIssue[] = [];
  const seen = new Set<string>();

  for (const item of [...base, ...next]) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
};

export const missingAdapterIssue = (namespace: string): TransactionIssue => ({
  kind: "issue",
  code: "transaction.adapter_missing",
  message: `No transaction adapter registered for namespace ${namespace}`,
  severity: "high",
  data: { namespace },
});

export const createMissingAdapterError = (namespace: string): Error => {
  const error = new Error(`No transaction adapter registered for namespace ${namespace}`);
  error.name = "TransactionAdapterMissingError";
  return error;
};

export const createReceiptTrackingUnsupportedError = (namespace: string): Error => {
  const error = new Error(`Receipt tracking is not supported for namespace "${namespace}".`);
  error.name = "ReceiptTrackingUnsupportedError";
  return error;
};

export const createTransactionSubmissionUnavailableError = (params: { namespace: string; chainRef: string }) => {
  const cause = createReceiptTrackingUnsupportedError(params.namespace);
  return arxError({
    reason: ArxReasons.ChainNotSupported,
    message: `Send transaction is not supported for namespace "${params.namespace}" because receipt tracking is unavailable.`,
    data: {
      namespace: params.namespace,
      chainRef: params.chainRef,
      missingCapability: "receiptTracking",
    },
    cause,
  });
};

export const issueFromPrepareError = (error: unknown): TransactionIssue => {
  if (error instanceof Error) {
    return {
      kind: "issue",
      code: "transaction.prepare_failed",
      message: error.message,
      severity: "high",
      data: { name: error.name },
    };
  }
  return {
    kind: "issue",
    code: "transaction.prepare_failed",
    message: String(error),
    severity: "high",
  };
};

export const coerceTransactionError = (reason?: Error | TransactionError | undefined): TransactionError | undefined => {
  if (!reason) return undefined;
  if ("name" in reason && "message" in reason && typeof reason.name === "string") {
    const error: TransactionError = {
      name: reason.name,
      message: reason.message ?? "",
    };
    const extra = reason as unknown as { code?: unknown; data?: unknown };
    if (typeof extra.code === "number") {
      error.code = extra.code;
    }
    if ("data" in extra) {
      error.data = extra.data;
    }
    return error;
  }
  return {
    name: "Error",
    message: String(reason),
  };
};

export const isUserRejectedError = (reason: unknown, coerced?: TransactionError): boolean => {
  const rejected = isArxError(reason) && reason.reason === ArxReasons.ApprovalRejected;
  return rejected || coerced?.code === 4001 || coerced?.name === "TransactionRejectedError";
};

export const buildPrepareContext = (meta: TransactionMeta): TransactionPrepareContext => ({
  namespace: meta.namespace,
  chainRef: meta.chainRef,
  origin: meta.origin,
  from: meta.from,
  request: cloneRequest(meta.request),
});

export const buildTrackingContext = (meta: TransactionMeta): TransactionTrackingContext => ({
  ...buildPrepareContext(meta),
  prepared: meta.prepared ? deepClone(meta.prepared) : null,
});

export const buildSignContext = (meta: TransactionMeta): TransactionSignContext => {
  const ctx = buildPrepareContext(meta);
  if (!ctx.from) {
    throw arxError({
      reason: ArxReasons.RpcInternal,
      message: "Failed to resolve from address for signing.",
      data: { id: meta.id, chainRef: meta.chainRef },
    });
  }
  return { ...ctx, from: ctx.from };
};
