import type { TransactionIntent } from "../intent/index.js";
import type { NamespaceTransactionReview } from "../review.js";
import type { TransactionError, TransactionPrepared } from "../types.js";

export type TransactionReviewBlocker = {
  reason: string;
  message: string;
  data?: unknown;
};

export type TransactionReviewError = {
  reason: string;
  message: string;
  data?: unknown;
};

/** Overall proposal lifetime, separate from prepare progress. */
export type TransactionProposalLifecycleStatus = "active" | "approved" | "terminated";

/** Prepare pipeline progress for the current request revision. */
export type TransactionProposalPrepareStatus = "idle" | "preparing" | "ready" | "blocked" | "failed" | "invalidated";

export type TransactionProposalTerminationReason =
  | "user_rejected"
  | "approval_cancelled"
  | "prepare_failed"
  | "execution_failed"
  | "internal_error";

export type TransactionProposalLifecycle = {
  status: TransactionProposalLifecycleStatus;
  terminationReason?: TransactionProposalTerminationReason;
  /** Terminal failure attached to the proposal lifecycle. */
  error?: TransactionError | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalPrepare = {
  /** Monotonic request version for stale-result rejection. */
  requestRevision: number;
  sessionToken: string | null;
  status: TransactionProposalPrepareStatus;
  prepared: TransactionPrepared | null;
  /** Prepared snapshot used by approval preview projection. */
  reviewSnapshot: TransactionPrepared | null;
  blocker?: TransactionReviewBlocker;
  error?: TransactionReviewError;
  invalidatedBy?: string;
};

/** Approval-facing projection derived from proposal state. */
export type TransactionApprovalPreview = {
  updatedAt: number;
  namespaceReview: NamespaceTransactionReview | null;
  prepare: {
    state: "preparing" | "ready" | "blocked" | "failed";
    blocker?: TransactionReviewBlocker;
    error?: TransactionReviewError;
  };
};

export type TransactionProposal = {
  id: string;
  approvalId: string;
  intent: TransactionIntent;
  lifecycle: TransactionProposalLifecycle;
  prepare: TransactionProposalPrepare;
};

/** Proposal read model exposed outside transaction orchestration. */
export type TransactionProposalView = TransactionProposal & {
  preview: TransactionApprovalPreview;
};
