import type { JsonValue } from "./json.js";
import { cloneJsonValue } from "./json.js";

export const TRANSACTION_TERMINAL_REASON_KINDS = [
  "user_rejected",
  "approval_cancelled",
  "approval_expired",
  "validation_failed",
  "prepare_failed",
  "signing_failed",
  "broadcast_failed",
  "broadcast_outcome_unknown",
  "on_chain_failed",
  "tracking_failed",
  "artifact_failed",
  "recovery_failed",
  "storage_failed",
  "internal_failed",
] as const;

export type TransactionTerminalReasonKind = (typeof TRANSACTION_TERMINAL_REASON_KINDS)[number];

/** Stable reason stored when a transaction or submission reaches a terminal state. */
export type TransactionTerminalReason = {
  kind: TransactionTerminalReasonKind;
  message: string;
  namespace: string | null;
  code: string;
  details: JsonValue | null;
  retryable: boolean;
};

/** Overrides for the default terminal reason text and metadata. */
export type BuildTransactionTerminalReasonInput = {
  kind: TransactionTerminalReasonKind;
  message?: string;
  namespace?: string | null;
  code?: string;
  details?: JsonValue;
  retryable?: boolean;
};

const DEFAULT_TERMINAL_REASON_MESSAGES: Record<TransactionTerminalReasonKind, string> = {
  user_rejected: "Transaction was rejected by the user.",
  approval_cancelled: "Transaction approval was cancelled.",
  approval_expired: "Transaction approval expired.",
  validation_failed: "Transaction validation failed.",
  prepare_failed: "Transaction preparation failed.",
  signing_failed: "Transaction signing failed.",
  broadcast_failed: "Transaction broadcast failed.",
  broadcast_outcome_unknown: "Transaction broadcast outcome is unknown.",
  on_chain_failed: "Transaction failed on chain.",
  tracking_failed: "Transaction tracking failed.",
  artifact_failed: "Transaction artifact handling failed.",
  recovery_failed: "Transaction recovery failed.",
  storage_failed: "Transaction storage failed.",
  internal_failed: "Transaction failed.",
};

export const buildTransactionTerminalReason = (
  input: BuildTransactionTerminalReasonInput,
): TransactionTerminalReason => ({
  kind: input.kind,
  message: input.message ?? DEFAULT_TERMINAL_REASON_MESSAGES[input.kind],
  namespace: input.namespace ?? null,
  code: input.code ?? input.kind,
  details: input.details === undefined ? null : cloneJsonValue(input.details),
  retryable: input.retryable ?? false,
});

export const cloneTransactionTerminalReason = (reason: TransactionTerminalReason): TransactionTerminalReason => ({
  kind: reason.kind,
  message: reason.message,
  namespace: reason.namespace,
  code: reason.code,
  details: reason.details === null ? null : cloneJsonValue(reason.details),
  retryable: reason.retryable,
});
