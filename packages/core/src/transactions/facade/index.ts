import type { TransactionIntent } from "../intent/index.js";
import type { TransactionProposal, TransactionProposalView } from "../proposal/index.js";
import type { TransactionRecordView } from "../record/index.js";
import type { NamespaceTransactionDraftEdit, TransactionError, TransactionSubmitted } from "../types.js";

export type TransactionBeginOptions = {
  /** Optional caller binding for request-scoped approval lifetime. */
  requestBinding?: {
    signal?: AbortSignal | null;
  };
};

/** Identifiers allocated during proposal creation. */
export type TransactionBeginHandoff = {
  transactionId: string;
  approvalId: string;
};

export type TransactionApprovalFailureReason =
  | "not_found"
  | "not_pending"
  | "prepare_not_ready"
  | "prepare_blocked"
  | "prepare_failed";

export type TransactionApprovalResult =
  | {
      status: "approved";
      transactionId: string;
    }
  | {
      status: "failed";
      reason: TransactionApprovalFailureReason;
      transaction?: TransactionProposal;
      message: string;
      data?: unknown;
    };

export type TransactionSubmissionPersistenceFailure = {
  transactionId: string;
  error: TransactionError;
  submitted: TransactionSubmitted;
};

export type TransactionSubmissionResolution = {
  submitted: TransactionSubmitted;
  /** Broadcast completed but record persistence still failed. */
  persistenceFailure?: TransactionSubmissionPersistenceFailure;
};

export type TransactionSubmissionTracker = {
  waitForOutcome(transactionId: string): Promise<TransactionSubmissionResolution>;
};

export type TransactionRecovery = {
  resume(): Promise<void>;
};

export type TransactionCommands = {
  begin(intent: TransactionIntent, options?: TransactionBeginOptions): Promise<TransactionBeginHandoff>;
  editRequest(input: { transactionId: string; edit: NamespaceTransactionDraftEdit; mode?: string }): Promise<void>;
  recomputePrepare(transactionId: string): Promise<void>;
  approve(transactionId: string): Promise<TransactionApprovalResult>;
  reject(transactionId: string, reason?: Error | TransactionError): Promise<void>;
};

export type TransactionQueries = {
  /** Proposal read model for approval and transaction detail surfaces. */
  getProposalView(transactionId: string): TransactionProposalView | undefined;
  /** Durable post-broadcast read model. */
  getRecordView(transactionId: string): TransactionRecordView | undefined;
};

export type TransactionEvents = {
  onProposalChanged(handler: (transactionIds: string[]) => void): () => void;
  onRecordChanged(handler: (transactionIds: string[]) => void): () => void;
  onApprovalDetailInvalidated(handler: (approvalIds: string[]) => void): () => void;
};

export type TransactionFacade = {
  commands: TransactionCommands;
  queries: TransactionQueries;
  /** Submission outcome tracking after approval. */
  submission: TransactionSubmissionTracker;
  recovery: TransactionRecovery;
  events: TransactionEvents;
};
