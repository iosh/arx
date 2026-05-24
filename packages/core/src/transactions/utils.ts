import { ArxReasons, isArxError } from "@arx/errors";
import type {
  TransactionPrepareContext,
  TransactionProposalStateContext,
  TransactionRecordContext,
  TransactionReplacementKey,
  TransactionSignContext,
  TransactionTrackingContext,
} from "./namespace/types.js";
import type { TransactionProposalTerminationReason } from "./proposal/index.js";
import type { TransactionProposalMeta } from "./proposal/types.js";
import type { TransactionRecordView } from "./record/index.js";
import type { TransactionError, TransactionSubmitted } from "./types.js";

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

export const createTransactionPersistenceError = (params: {
  cause: Error;
  transactionId: string;
  submitted: TransactionSubmitted;
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
  },
});

export const coerceTransactionError = (reason?: Error | TransactionError | undefined): TransactionError | undefined => {
  if (!reason) return undefined;
  if (isArxError(reason) && reason.reason === ArxReasons.TransportDisconnected) {
    return {
      name: "TransactionCallerDisconnectedError",
      message: reason.message,
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

export const deriveExecutionTerminationReason = (reason: unknown): TransactionProposalTerminationReason => {
  const error = coerceTransactionError(
    reason && (reason instanceof Error || (typeof reason === "object" && "name" in reason && "message" in reason))
      ? (reason as Error | TransactionError)
      : undefined,
  );

  if (isUserRejectedError(reason, error)) {
    return "user_rejected";
  }

  return "execution_failed";
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
  from: record.accountAddress,
});

export const buildTrackingContext = (record: TransactionRecordView): TransactionTrackingContext => ({
  ...buildRecordContext(record),
  submitted: structuredClone(record.submitted),
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
