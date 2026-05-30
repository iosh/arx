import type { TransactionIntent } from "../intent/index.js";
import type { TransactionReviewDetails } from "../review.js";
import type { TransactionError, TransactionPrepared, TransactionReviewSnapshot } from "../types.js";

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

export type TransactionProposalStatus = "active" | "approved" | "terminated";

/** Prepare pipeline progress for the current request revision. */
export type TransactionProposalPrepareStatus = "preparing" | "ready" | "blocked" | "failed" | "invalidated";

export type TransactionProposalTerminationReason =
  | "user_rejected"
  | "approval_cancelled"
  | "execution_failed"
  | "internal_error";

export type TransactionProposalTermination = {
  reason: TransactionProposalTerminationReason;
  error: TransactionError | null;
  userRejected: boolean;
};

export type TransactionProposalPrepare = {
  /** Monotonic request version for stale-result rejection. */
  requestRevision: number;
  sessionToken: string;
  status: TransactionProposalPrepareStatus;
  prepared: TransactionPrepared | null;
  /** Prepared snapshot used by approval preview projection. */
  reviewSnapshot: TransactionReviewSnapshot | null;
  blocker?: TransactionReviewBlocker;
  error?: TransactionReviewError;
  invalidatedBy?: string;
};

/** Approval-facing projection derived from proposal state. */
export type TransactionApprovalPreview = {
  updatedAt: number;
  details: TransactionReviewDetails | null;
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
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination;
  createdAt: number;
  updatedAt: number;
  prepare: TransactionProposalPrepare;
};

/** Proposal read model exposed outside transaction orchestration. */
export type TransactionProposalView = TransactionProposal & {
  /** Present while approval review state is available. */
  preview?: TransactionApprovalPreview;
};
