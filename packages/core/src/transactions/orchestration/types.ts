import type { TransactionProposalTerminationReason } from "../proposal/index.js";
import type { TransactionProposalSnapshot } from "../proposal/types.js";
import type { TransactionError, TransactionSubmitted } from "../types.js";

export type TransactionApprovalFailureReason =
  | "not_found"
  | "not_pending"
  | "prepare_not_ready"
  | "prepare_blocked"
  | "prepare_failed";

export type TransactionApprovalResult =
  | { status: "approved"; transactionId: string }
  | {
      status: "failed";
      reason: TransactionApprovalFailureReason;
      transaction?: TransactionProposalSnapshot | undefined;
      message: string;
      data?: unknown;
    };

export type TransactionSubmissionResolution = {
  submitted: TransactionSubmitted;
  persistenceFailure?: TransactionSubmissionPersistenceFailure | undefined;
};

export type TransactionSubmissionPersistenceFailure = {
  transactionId: string;
  error: TransactionError;
  submitted: TransactionSubmitted;
};

export type TransactionSubmissionFailure = {
  transactionId: string;
  error: TransactionError | null;
  terminationReason: TransactionProposalTerminationReason;
  userRejected: boolean;
  message: string;
};

export class TransactionSubmissionError extends Error {
  readonly failure: TransactionSubmissionFailure;

  constructor(failure: TransactionSubmissionFailure) {
    super(failure.message);
    this.name = "TransactionSubmissionError";
    this.failure = structuredClone(failure);
  }
}

export class TransactionSubmissionPersistenceError extends Error {
  readonly failure: TransactionSubmissionPersistenceFailure;

  constructor(failure: TransactionSubmissionPersistenceFailure) {
    super(failure.error.message);
    this.name = "TransactionSubmissionPersistenceError";
    this.failure = structuredClone(failure);
  }
}

export const isTransactionSubmissionError = (error: unknown): error is TransactionSubmissionError =>
  error instanceof TransactionSubmissionError;

export const isTransactionSubmissionPersistenceError = (
  error: unknown,
): error is TransactionSubmissionPersistenceError => error instanceof TransactionSubmissionPersistenceError;

export type TransactionSubmissionTracker = {
  waitForSubmissionOutcome(id: string): Promise<TransactionSubmissionResolution>;
};

export type TransactionApprovalExecutor = {
  approveTransaction(id: string): Promise<TransactionApprovalResult>;
  rejectTransaction(input: {
    id: string;
    reason?: Error | TransactionError;
    terminationReason: TransactionProposalTerminationReason;
  }): Promise<void>;
};

export type TransactionRecoveryRuntime = {
  resumeTransactions(): Promise<void>;
};

export type ApprovalDetailInvalidationEvents = {
  onChanged(handler: (change: import("../events.js").ApprovalDetailInvalidation) => void): () => void;
};
