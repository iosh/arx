import type { AccountAddress } from "../../accounts/runtime/types.js";
import type { ChainRef } from "../../chains/ids.js";
import type { TransactionConflictKey, TransactionReplacementType } from "../aggregate/types.js";
import type { TransactionReviewDetails } from "../review.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionReviewSnapshot,
  TransactionSubmitted,
} from "../types.js";

// User-resolvable proposal stop: review can be shown, but approval is not allowed.
export type TransactionProposalBlocker = {
  reason: string;
  message: string;
  data?: unknown;
};

// Prepare/review infrastructure failure: retry or reject instead of approve.
export type TransactionProposalError = {
  reason: string;
  message: string;
  data?: unknown;
};

export type TransactionApprovalStale = {
  reason: string;
  message: string;
  data?: unknown;
};

// Execution/tracking failure normalized for namespace-owned flow results.
export type TransactionFailure = {
  reason: string;
  message: string;
  data?: unknown;
};

/** Result of one namespace prepare pass. */
export type TransactionPrepareResult<TPrepared = TransactionPrepared, TReviewSnapshot = TPrepared> =
  | { status: "ready"; prepared: TPrepared; reviewSnapshot?: TReviewSnapshot | null }
  | { status: "blocked"; blocker: TransactionProposalBlocker; reviewSnapshot?: TReviewSnapshot | null }
  | { status: "failed"; error: TransactionProposalError; reviewSnapshot?: TReviewSnapshot | null };

/** Signed payload ready for namespace-owned broadcast. */
export type SignedTransactionPayload = {
  raw: string;
  hash?: string | null;
};

export type BroadcastArtifact = {
  kind: string;
  payload: Record<string, unknown>;
};

export type BroadcastResult<TNamespace extends string = string> = {
  broadcastIdentity: Record<string, unknown>;
  submitted: TransactionSubmitted<TNamespace>;
};

export type SubmittedTransactionInspection<TNamespace extends string = string> =
  | {
      trackingStatus: "pending";
      evidence: Record<string, unknown> | null;
    }
  | {
      trackingStatus: "confirmed";
      receipt: TransactionReceipt<TNamespace>;
    }
  | {
      trackingStatus: "failed";
      receipt: TransactionReceipt<TNamespace> | null;
      error: TransactionFailure;
    }
  | {
      trackingStatus: "dropped";
      evidence: Record<string, unknown> | null;
    }
  | {
      trackingStatus: "expired";
      evidence: Record<string, unknown> | null;
    };

export type PendingSubmittedTransactionInspection<TNamespace extends string = string> = Extract<
  SubmittedTransactionInspection<TNamespace>,
  { trackingStatus: "pending" }
>;

export type TransactionSignOptions = {
  signal?: AbortSignal | undefined;
};

export type TransactionPrepareContext<TNamespace extends string = string> = {
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest<TNamespace>;
};

export type TransactionValidationContext<TNamespace extends string = string> = TransactionPrepareContext<TNamespace>;

export type TransactionSignContext<TNamespace extends string = string> = Omit<
  TransactionPrepareContext<TNamespace>,
  "from"
> & {
  from: AccountAddress;
};

export type TransactionProposalStateContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
};

export type TransactionRecordContext<TNamespace extends string = string> = {
  recordId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
};

export type TransactionTrackingContext<TNamespace extends string = string> = TransactionRecordContext<TNamespace> & {
  submitted: TransactionSubmitted<TNamespace>;
};

export type TransactionPendingInspectionDelayContext<TNamespace extends string = string> =
  TransactionTrackingContext<TNamespace> & {
    attempt: number;
    inspection: PendingSubmittedTransactionInspection<TNamespace>;
  };

export type TransactionRetryInspectionDelayContext<TNamespace extends string = string> =
  TransactionTrackingContext<TNamespace> & {
    attempt: number;
    failure: TransactionFailure;
  };

export type TransactionApprovalReviewContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
  /** Latest prepared snapshot available to the review builder. */
  reviewSnapshot: TransactionReviewSnapshot<TNamespace> | null;
};

export type TransactionDraftEditContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest<TNamespace>;
  edit: NamespaceTransactionDraftEdit<TNamespace>;
  mode?: string;
};

export type TransactionProposalConflictContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
  approvedPayload: TransactionPrepared<TNamespace>;
};

export type TransactionApprovalResourceKey = {
  kind: string;
  value: string;
};

export type TransactionApprovalResourceContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: AccountAddress;
};

export type TransactionApprovalFinalizeContext<TNamespace extends string = string> = {
  transactionId: string;
  approvalId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
  approvedPayload: TransactionPrepared<TNamespace>;
  replacement: {
    transactionId: string;
    type: TransactionReplacementType | null;
  } | null;
  localActiveTransactions: readonly {
    transactionId: string;
    status: "submitting" | "submitted";
    approvedPayload: TransactionPrepared<TNamespace>;
    conflictKey: TransactionConflictKey | null;
  }[];
};

export type TransactionApprovalFinalizeResult<TNamespace extends string = string> =
  | {
      status: "approved";
      approvedPayload: TransactionPrepared<TNamespace>;
      conflictKey: TransactionConflictKey | null;
      expiresAt: number | null;
    }
  | {
      status: "approval_stale";
      stale: TransactionApprovalStale;
    }
  | {
      status: "blocked";
      blocker: TransactionProposalBlocker;
      reviewSnapshot?: TransactionReviewSnapshot<TNamespace> | null;
    }
  | {
      status: "failed";
      error: TransactionProposalError;
      reviewSnapshot?: TransactionReviewSnapshot<TNamespace> | null;
    };

export type TransactionBroadcastArtifactContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
  approvedPayload: TransactionPrepared<TNamespace>;
};

export type TransactionBroadcastContext<TNamespace extends string = string> =
  TransactionBroadcastArtifactContext<TNamespace> & {
    broadcastArtifact: BroadcastArtifact;
  };

export type NamespaceTransactionRequest<TNamespace extends string = string> = {
  deriveForChain?(request: TransactionRequest<TNamespace>, chainRef: ChainRef): TransactionRequest<TNamespace>;
  validateRequest?(context: TransactionValidationContext<TNamespace>): void;
};

export type NamespaceTransactionProposal<TNamespace extends string = string> = {
  prepare(
    context: TransactionPrepareContext<TNamespace>,
  ): Promise<TransactionPrepareResult<TransactionPrepared<TNamespace>, TransactionReviewSnapshot<TNamespace>>>;
  buildReview?(context: TransactionApprovalReviewContext<TNamespace>): TransactionReviewDetails | null;
  applyDraftEdit?(context: TransactionDraftEditContext<TNamespace>): TransactionRequest<TNamespace>;
  deriveApprovalResourceKey?(
    context: TransactionApprovalResourceContext<TNamespace>,
  ): TransactionApprovalResourceKey | null;
  finalizeApproval?(
    context: TransactionApprovalFinalizeContext<TNamespace>,
  ): Promise<TransactionApprovalFinalizeResult<TNamespace>>;
  deriveConflictKey?(context: TransactionProposalConflictContext<TNamespace>): TransactionConflictKey | null;
};

export type NamespaceTransactionSubmission<TNamespace extends string = string> = {
  createBroadcastArtifact(
    context: TransactionBroadcastArtifactContext<TNamespace>,
    options?: TransactionSignOptions,
  ): Promise<BroadcastArtifact>;
  broadcast(context: TransactionBroadcastContext<TNamespace>): Promise<BroadcastResult<TNamespace>>;
};

export type NamespaceTransactionTracking<TNamespace extends string = string> = {
  inspectSubmittedTransaction(
    context: TransactionTrackingContext<TNamespace>,
  ): Promise<SubmittedTransactionInspection<TNamespace>>;
  getInitialInspectionDelay(context: TransactionTrackingContext<TNamespace>): number;
  getPendingInspectionDelay(context: TransactionPendingInspectionDelayContext<TNamespace>): number;
  getRetryInspectionDelay(context: TransactionRetryInspectionDelayContext<TNamespace>): number;
};

export type NamespaceTransaction<TNamespace extends string = string> = {
  request?: NamespaceTransactionRequest<TNamespace>;
  proposal?: NamespaceTransactionProposal<TNamespace>;
  submission?: NamespaceTransactionSubmission<TNamespace>;
  tracking?: NamespaceTransactionTracking<TNamespace>;
};

export type AnyNamespaceTransaction = NamespaceTransaction<string>;
