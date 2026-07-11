import type {
  BroadcastingTransactionRecord,
  ConfirmedTransactionRecord,
  DroppedTransactionRecord,
  ExpiredTransactionRecord,
  FailedAfterSubmissionTransactionRecord,
  FailedBeforeSubmissionTransactionRecord,
  ReplacedTransactionRecord,
  SubmittedTransactionRecord,
  SubmittingTransactionRecord,
  TransactionFailureReason,
  TransactionJsonObject,
  TransactionRecord,
} from "./persistence.js";
import { TransactionLifecycleTransitionError } from "./recordErrors.js";

const transition = <TRecord extends TransactionRecord>(
  current: TransactionRecord,
  next: TRecord,
  allowed: readonly TransactionRecord["status"][],
): TRecord => {
  if (!allowed.includes(current.status)) {
    throw new TransactionLifecycleTransitionError({
      transactionId: current.transactionId,
      current: current.status,
      next: next.status,
    });
  }
  return next;
};

const rejectTransition = (record: TransactionRecord, next: TransactionRecord["status"]): never => {
  throw new TransactionLifecycleTransitionError({
    transactionId: record.transactionId,
    current: record.status,
    next,
  });
};

export const createSubmittingTransaction = (
  record: Omit<SubmittingTransactionRecord, "status">,
): SubmittingTransactionRecord => ({ ...record, status: "submitting" });

export const markTransactionBroadcasting = (record: TransactionRecord): BroadcastingTransactionRecord =>
  transition(record, { ...record, status: "broadcasting" }, ["submitting"]);

export const markTransactionSubmitted = (
  record: TransactionRecord,
  networkSubmission: TransactionJsonObject,
): SubmittedTransactionRecord =>
  transition(record, { ...record, status: "submitted", networkSubmission }, ["broadcasting"]);

export const failTransactionBeforeSubmission = (
  record: TransactionRecord,
  params: { phase: "submitting" | "broadcasting"; reason: TransactionFailureReason },
): FailedBeforeSubmissionTransactionRecord =>
  transition(record, { ...record, status: "failed", phase: params.phase, reason: params.reason }, [params.phase]);

export const confirmTransaction = (
  record: TransactionRecord,
  confirmation: TransactionJsonObject,
): ConfirmedTransactionRecord => {
  if (record.status !== "submitted") return rejectTransition(record, "confirmed");
  return { ...record, status: "confirmed", confirmation };
};

export const failSubmittedTransaction = (
  record: TransactionRecord,
  params: { reason: TransactionFailureReason; evidence?: TransactionJsonObject },
): FailedAfterSubmissionTransactionRecord => {
  if (record.status !== "submitted") return rejectTransition(record, "failed");
  return {
    ...record,
    status: "failed",
    phase: "submitted",
    reason: params.reason,
    ...(params.evidence ? { evidence: params.evidence } : {}),
  };
};

export const replaceTransaction = (
  record: TransactionRecord,
  replacedByTransactionId: string,
): ReplacedTransactionRecord => {
  if (record.status !== "submitted") return rejectTransition(record, "replaced");
  return { ...record, status: "replaced", replacedByTransactionId };
};

export const dropTransaction = (
  record: TransactionRecord,
  evidence?: TransactionJsonObject,
): DroppedTransactionRecord => {
  if (record.status !== "submitted") return rejectTransition(record, "dropped");
  return { ...record, status: "dropped", ...(evidence ? { evidence } : {}) };
};

export const expireTransaction = (
  record: TransactionRecord,
  evidence?: TransactionJsonObject,
): ExpiredTransactionRecord => {
  if (record.status !== "submitted") return rejectTransition(record, "expired");
  return { ...record, status: "expired", ...(evidence ? { evidence } : {}) };
};

export const interruptTransaction = (record: TransactionRecord): FailedBeforeSubmissionTransactionRecord => {
  if (record.status === "submitting") {
    return failTransactionBeforeSubmission(record, {
      phase: "submitting",
      reason: {
        code: "transaction.interrupted_before_signing",
        message: "Transaction submission was interrupted before signing completed.",
      },
    });
  }
  return failTransactionBeforeSubmission(record, {
    phase: "broadcasting",
    reason: {
      code: "transaction.broadcast_outcome_unknown",
      message: "Transaction broadcast outcome is unknown after restart.",
    },
  });
};
