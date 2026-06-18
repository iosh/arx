import type { TransactionStatus, TransactionSubmissionStatus } from "./types.js";

type TransactionStateMachine = "transaction" | "submission";

export class TransactionStatusTransitionError extends Error {
  readonly machine: TransactionStateMachine;
  readonly from: TransactionStatus | TransactionSubmissionStatus;
  readonly to: TransactionStatus | TransactionSubmissionStatus;

  constructor(input: {
    machine: TransactionStateMachine;
    from: TransactionStatus | TransactionSubmissionStatus;
    to: TransactionStatus | TransactionSubmissionStatus;
  }) {
    super(`Invalid ${input.machine} status transition: ${input.from} -> ${input.to}`);
    this.name = "TransactionStatusTransitionError";
    this.machine = input.machine;
    this.from = input.from;
    this.to = input.to;
  }
}

/**
 * Transaction:
 *
 * cancelled  -> terminal
 * expired    -> terminal
 * submitting -> submitted | failed | cancelled | expired
 * submitted  -> confirmed | failed | replaced | dropped | expired
 */
const TRANSACTION_STATUS_TRANSITIONS = {
  cancelled: [],
  expired: [],
  submitting: ["submitted", "failed", "cancelled", "expired"],
  submitted: ["confirmed", "failed", "replaced", "dropped", "expired"],
  confirmed: [],
  failed: [],
  replaced: [],
  dropped: [],
} as const satisfies Record<TransactionStatus, readonly TransactionStatus[]>;

/**
 * Submission:
 *
 * queued -> signing -> broadcasting -> accepted
 *   |        |             |
 *   +--------+-------------+-> failed | cancelled | expired
 */
const TRANSACTION_SUBMISSION_STATUS_TRANSITIONS = {
  queued: ["signing", "cancelled", "expired", "failed"],
  signing: ["broadcasting", "cancelled", "expired", "failed"],
  broadcasting: ["accepted", "expired", "failed"],
  accepted: [],
  failed: [],
  cancelled: [],
  expired: [],
} as const satisfies Record<TransactionSubmissionStatus, readonly TransactionSubmissionStatus[]>;

/** True when the transaction status move is allowed. */
export const canTransitionTransactionStatus = (from: TransactionStatus, to: TransactionStatus): boolean => {
  const allowed: readonly TransactionStatus[] = TRANSACTION_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
};

/** Throws if the transaction status move is not allowed. */
export const assertTransactionStatusTransition = (from: TransactionStatus, to: TransactionStatus): void => {
  if (canTransitionTransactionStatus(from, to)) return;
  throw new TransactionStatusTransitionError({ machine: "transaction", from, to });
};

/** True when no later transaction status is valid. */
export const isTransactionStatusTerminal = (status: TransactionStatus): boolean => {
  return TRANSACTION_STATUS_TRANSITIONS[status].length === 0;
};

/** True when the submission status move is allowed. */
export const canTransitionTransactionSubmissionStatus = (
  from: TransactionSubmissionStatus,
  to: TransactionSubmissionStatus,
): boolean => {
  const allowed: readonly TransactionSubmissionStatus[] = TRANSACTION_SUBMISSION_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
};

/** Throws if the submission status move is not allowed. */
export const assertTransactionSubmissionStatusTransition = (
  from: TransactionSubmissionStatus,
  to: TransactionSubmissionStatus,
): void => {
  if (canTransitionTransactionSubmissionStatus(from, to)) return;
  throw new TransactionStatusTransitionError({ machine: "submission", from, to });
};

/** True when no later submission status is valid. */
export const isTransactionSubmissionStatusTerminal = (status: TransactionSubmissionStatus): boolean => {
  return TRANSACTION_SUBMISSION_STATUS_TRANSITIONS[status].length === 0;
};
