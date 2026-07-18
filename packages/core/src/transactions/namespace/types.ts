import type { ChainRef } from "../../chains/ids.js";
import type { JsonObject } from "../aggregate/json.js";
import type { TransactionConflictKey, TransactionReplacementType, TransactionResourceKey } from "../aggregate/types.js";
import type { TransactionReviewDetails } from "../review.js";
import type {
  TransactionApproved,
  TransactionBroadcastArtifact,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionReviewSnapshot,
  TransactionSubmitted,
} from "../types.js";

export type TransactionIssue = {
  code: string;
  message: string;
  details: JsonObject;
};

// User-resolvable proposal stop: review can be shown, but approval is not allowed.
export type TransactionProposalBlocker = TransactionIssue;

// Prepare/review infrastructure failure: retry or reject instead of approve.
export type TransactionProposalError = TransactionIssue;

// Execution/tracking failure normalized for namespace-owned flow results.
export type TransactionFailure = TransactionIssue;

/** Result of one namespace prepare pass. */
export type TransactionPrepareResult<TPrepared = TransactionPrepared, TReviewSnapshot = TPrepared> =
  | { status: "ready"; prepared: TPrepared; reviewSnapshot: TReviewSnapshot }
  | { status: "blocked"; blocker: TransactionProposalBlocker; reviewSnapshot: TReviewSnapshot | null }
  | { status: "failed"; error: TransactionProposalError; reviewSnapshot: TReviewSnapshot | null };

/** Signed payload ready for namespace-owned broadcast. */
export type SignedTransactionPayload = {
  raw: string;
  hash?: string | null;
};

export type BroadcastArtifact = {
  kind: string;
  payload: JsonObject;
};

export type BroadcastResult<TNamespace extends string = string> = {
  broadcastIdentity: JsonObject;
  submitted: TransactionSubmitted<TNamespace>;
};

export type SubmittedTransactionInspection<TNamespace extends string = string> =
  | {
      trackingStatus: "pending";
      evidence: JsonObject | null;
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
      evidence: JsonObject | null;
    }
  | {
      trackingStatus: "expired";
      evidence: JsonObject | null;
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
  from: string | null;
  request: TransactionRequest<TNamespace>;
};

export type TransactionValidationContext<TNamespace extends string = string> = TransactionPrepareContext<TNamespace>;

export type TransactionSignContext<TNamespace extends string = string> = Omit<
  TransactionPrepareContext<TNamespace>,
  "from"
> & {
  from: string;
};

export type TransactionProposalStateContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: string;
  request: TransactionRequest<TNamespace>;
};

export type TransactionRecordContext<TNamespace extends string = string> = {
  recordId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: string | null;
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

export type TransactionReviewContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: string;
  request: TransactionRequest<TNamespace>;
  /** Latest prepared snapshot available to the review builder. */
  reviewSnapshot: TransactionReviewSnapshot<TNamespace> | null;
};

export type TransactionResourceKeyContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountId: string;
  from: string;
  request: TransactionRequest<TNamespace>;
  preparedPayload: TransactionPrepared<TNamespace>;
  replacement: {
    transactionId: string;
    type: TransactionReplacementType;
  } | null;
};

export type TransactionReplacementRequestContext<TNamespace extends string = string> = {
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountId: string;
  from: string;
  type: TransactionReplacementType;
  targetTransactionId: string;
  targetRequest: TransactionRequest<TNamespace>;
  targetApprovedPayload: TransactionApproved<TNamespace>;
};

export type TransactionFinalizeSubmitContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountId: string;
  from: string;
  request: TransactionRequest<TNamespace>;
  preparedPayload: TransactionPrepared<TNamespace>;
  replacement: {
    transactionId: string;
    type: TransactionReplacementType;
  } | null;
  localActiveTransactions: readonly {
    transactionId: string;
    status: "submitting" | "submitted";
    approvedPayload: TransactionApproved<TNamespace>;
    conflictKey: TransactionConflictKey | null;
  }[];
};

export type TransactionFinalizeSubmitResult<TNamespace extends string = string> =
  | {
      status: "approved";
      approvedPayload: TransactionApproved<TNamespace>;
      conflictKey: TransactionConflictKey | null;
    }
  | {
      status: "blocked";
      blocker: TransactionProposalBlocker;
      reviewSnapshot: TransactionReviewSnapshot<TNamespace> | null;
    }
  | {
      status: "failed";
      error: TransactionProposalError;
      reviewSnapshot: TransactionReviewSnapshot<TNamespace> | null;
    };

export type TransactionBroadcastArtifactContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountId: string;
  from: string;
  request: TransactionRequest<TNamespace>;
  approvedPayload: TransactionApproved<TNamespace>;
};

export type TransactionBroadcastContext<TNamespace extends string = string> =
  TransactionBroadcastArtifactContext<TNamespace> & {
    broadcastArtifact: TransactionBroadcastArtifact<TNamespace>;
  };

export type NamespaceTransactionRequest<TNamespace extends string = string> = {
  deriveForChain(request: TransactionRequest<TNamespace>, chainRef: ChainRef): TransactionRequest<TNamespace>;
  validateRequest(context: TransactionValidationContext<TNamespace>): void;
};

export type NamespaceTransactionProposal<TNamespace extends string = string> = {
  prepare(
    context: TransactionPrepareContext<TNamespace>,
  ): Promise<TransactionPrepareResult<TransactionPrepared<TNamespace>, TransactionReviewSnapshot<TNamespace>>>;
  buildReview(context: TransactionReviewContext<TNamespace>): TransactionReviewDetails | null;
  buildReplacementRequest(
    context: TransactionReplacementRequestContext<TNamespace>,
  ): Promise<TransactionRequest<TNamespace>>;
  deriveResourceKey(context: TransactionResourceKeyContext<TNamespace>): TransactionResourceKey | null;
  finalizeSubmit(
    context: TransactionFinalizeSubmitContext<TNamespace>,
  ): Promise<TransactionFinalizeSubmitResult<TNamespace>>;
};

export type NamespaceTransactionSubmission<TNamespace extends string = string> = {
  createBroadcastArtifact(
    context: TransactionBroadcastArtifactContext<TNamespace>,
    options?: TransactionSignOptions,
  ): Promise<TransactionBroadcastArtifact<TNamespace>>;
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
  request: NamespaceTransactionRequest<TNamespace>;
  proposal: NamespaceTransactionProposal<TNamespace>;
  submission: NamespaceTransactionSubmission<TNamespace>;
  tracking: NamespaceTransactionTracking<TNamespace>;
};

export type AnyNamespaceTransaction = NamespaceTransaction<string>;
