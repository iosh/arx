import { ArxReasons, arxError, isArxError } from "@arx/errors";
import type {
  TransactionPrepareContext,
  TransactionProposalStateContext,
  TransactionRecordContext,
  TransactionReplacementKey,
  TransactionSignContext,
  TransactionTrackingContext,
} from "../../transactions/namespace/types.js";
import type { TransactionError, TransactionSubmissionLocator, TransactionSubmitted } from "../../transactions/types.js";
import type { TransactionProposalMeta, TransactionRecordView } from "./types.js";

export const createMissingNamespaceTransactionError = (namespace: string): Error => {
  const error = new Error(`No namespace transaction registered for namespace ${namespace}`);
  error.name = "NamespaceTransactionMissingError";
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

export const createTransactionPersistenceError = (params: {
  cause: Error;
  transactionId: string;
  submitted: TransactionSubmitted;
  locator: TransactionSubmissionLocator;
}): TransactionError => ({
  name: "TransactionPersistenceError",
  message: "Transaction was broadcast but could not be persisted locally.",
  data: {
    cause: {
      name: params.cause.name,
      message: params.cause.message,
    },
    transactionId: params.transactionId,
    submitted: structuredClone(params.submitted),
    locator: structuredClone(params.locator),
  },
});

export const coerceTransactionError = (reason?: Error | TransactionError | undefined): TransactionError | undefined => {
  if (!reason) return undefined;
  if (isArxError(reason) && reason.reason === ArxReasons.TransportDisconnected) {
    return {
      name: "TransportDisconnectedError",
      message: reason.message,
      code: 4900,
      ...(reason.data !== undefined ? { data: reason.data } : {}),
    };
  }
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

export const buildProposalStateContext = (meta: TransactionProposalMeta): TransactionProposalStateContext => ({
  transactionId: meta.id,
  namespace: meta.namespace,
  chainRef: meta.chainRef,
  origin: meta.origin,
  from: meta.from,
  request: structuredClone(meta.request),
});

export const buildPrepareContext = (meta: TransactionProposalMeta): TransactionPrepareContext => {
  const proposal = buildProposalStateContext(meta);
  return {
    namespace: proposal.namespace,
    chainRef: proposal.chainRef,
    origin: proposal.origin,
    from: proposal.from,
    request: proposal.request,
  };
};

export const buildRecordContext = (record: TransactionRecordView): TransactionRecordContext => ({
  recordId: record.id,
  namespace: record.namespace,
  chainRef: record.chainRef,
  origin: record.origin,
  from: record.from,
});

export const buildTrackingContext = (record: TransactionRecordView): TransactionTrackingContext => ({
  ...buildRecordContext(record),
  submitted: structuredClone(record.submitted),
  locator: structuredClone(record.locator),
});

export const encodeReplacementKey = (key: TransactionReplacementKey): string => {
  return `${key.scope}:${key.value}`;
};

export const buildSignContext = (meta: TransactionProposalMeta): TransactionSignContext => {
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
