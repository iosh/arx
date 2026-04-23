import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type {
  TransactionPrepareContext,
  TransactionReplacementKey,
  TransactionSignContext,
  TransactionTrackingContext,
} from "../../transactions/adapters/types.js";
import type { TransactionError, TransactionMeta } from "./types.js";

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
  request: structuredClone(meta.request ?? { namespace: meta.namespace, chainRef: meta.chainRef, payload: {} }),
});

export const buildTrackingContext = (meta: TransactionMeta): TransactionTrackingContext | null => {
  if (!meta.submitted || !meta.locator) {
    return null;
  }

  return {
    namespace: meta.namespace,
    chainRef: meta.chainRef,
    origin: meta.origin,
    from: meta.from,
    request: structuredClone(meta.request),
    submitted: structuredClone(meta.submitted),
    locator: structuredClone(meta.locator),
  };
};

export const encodeReplacementKey = (key: TransactionReplacementKey): string => {
  return `${key.scope}:${key.value}`;
};

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
