import type {
  BeginTransactionApprovalOptions,
  ProviderTransactionSubmission,
  TransactionApprovalReviewReader,
  TransactionProposalReader,
  TransactionRecordReader,
} from "../controllers/transaction/types.js";
import type { RequestContext } from "../rpc/requestContext.js";
import type { TransactionIntent } from "./intent/index.js";
import type { TransactionProposal, TransactionProposalView } from "./proposal/index.js";
import type { TransactionRecordView } from "./record/index.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionError,
  TransactionRequest,
  TransactionSubmitted,
} from "./types.js";

export type TransactionRequestScope = {
  /** Caller-owned lifetime that can cancel approval before broadcast. */
  abortSignal?: AbortSignal | null;
};

export type TransactionCreateProposalOptions = {
  requestContext?: RequestContext;
};

export type TransactionRequestApprovalOptions = {
  requestContext: RequestContext;
  requestScope?: TransactionRequestScope;
};

/** Identifier allocated during proposal creation. */
export type TransactionCreateProposalResult = {
  transactionId: string;
};

/** Identifier allocated during approval request creation. */
export type TransactionRequestApprovalResult = {
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
  createProposal(
    intent: TransactionIntent,
    options?: TransactionCreateProposalOptions,
  ): Promise<TransactionCreateProposalResult>;
  requestApproval(
    transactionId: string,
    options: TransactionRequestApprovalOptions,
  ): Promise<TransactionRequestApprovalResult>;
  editRequest(input: { transactionId: string; edit: NamespaceTransactionDraftEdit; mode?: string }): Promise<void>;
  recomputePrepare(transactionId: string): Promise<void>;
  approve(transactionId: string): Promise<TransactionApprovalResult>;
  reject(transactionId: string, reason?: Error | TransactionError): Promise<void>;
};

export type TransactionQueries = {
  /** Proposal read model for approval and transaction detail surfaces. */
  getProposalView(transactionId: string): TransactionProposalView | undefined;
  /** Post-broadcast transaction read model. */
  getRecordView(transactionId: string): TransactionRecordView | undefined;
};

export type TransactionEvents = {
  onProposalChanged(handler: (transactionIds: string[]) => void): () => void;
  onRecordChanged(handler: (transactionIds: string[]) => void): () => void;
  onApprovalDetailInvalidated(handler: (approvalIds: string[]) => void): () => void;
};

export type TransactionAccess = {
  commands: TransactionCommands;
  queries: TransactionQueries;
  /** Submission outcome tracking after approval. */
  submission: TransactionSubmissionTracker;
  recovery: TransactionRecovery;
  events: TransactionEvents;
};

export type ProviderTransactionSubmissionCommands = {
  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<ProviderTransactionSubmission>;
};

export type TransactionPublicRuntime = {
  access: TransactionAccess;
  provider: ProviderTransactionSubmissionCommands;
  submission: TransactionSubmissionTracker;
  recovery: TransactionRecovery;
  review: TransactionApprovalReviewReader;
  proposals: TransactionProposalReader;
  records: TransactionRecordReader;
};
