import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
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

// Legacy execution payload kept for the old transaction runtime until replacement.
export type SignedTransactionPayload = {
  raw: string;
  hash?: string | null;
};

export type BroadcastInput = {
  kind: string;
  payload: Record<string, unknown>;
};

export type BroadcastResult<TNamespace extends string = string> = {
  broadcastIdentity: Record<string, unknown>;
  submitted: TransactionSubmitted<TNamespace>;
};

export type SubmittedTransactionInspection<TNamespace extends string = string> =
  | {
      chainStatus: "pending";
      evidence: Record<string, unknown> | null;
    }
  | {
      chainStatus: "confirmed";
      receipt: TransactionReceipt<TNamespace>;
    }
  | {
      chainStatus: "failed";
      receipt: TransactionReceipt<TNamespace> | null;
      error: TransactionFailure;
    }
  | {
      chainStatus: "dropped";
      evidence: Record<string, unknown> | null;
    }
  | {
      chainStatus: "expired";
      evidence: Record<string, unknown> | null;
    };

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

export type TransactionReplacementKey = {
  scope: string;
  value: string;
};

export type ReceiptResolution<TNamespace extends string = string> =
  | { status: "success"; receipt: TransactionReceipt<TNamespace> }
  | { status: "failed"; receipt: TransactionReceipt<TNamespace> };

export type ReplacementResolution = {
  replacedByRecordId?: string | null;
  status: "replaced";
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

export type TransactionBroadcastInputContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: AccountAddress;
  request: TransactionRequest<TNamespace>;
  approvedPayload: TransactionPrepared<TNamespace>;
};

export type TransactionBroadcastContext<TNamespace extends string = string> = Omit<
  TransactionBroadcastInputContext<TNamespace>,
  never
> & {
  broadcastInput: BroadcastInput;
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

// Legacy execution contract kept for the old transaction runtime.
export type NamespaceTransactionExecution<TNamespace extends string = string> = {
  sign(
    context: TransactionSignContext<TNamespace>,
    prepared: TransactionPrepared<TNamespace>,
    options?: TransactionSignOptions,
  ): Promise<SignedTransactionPayload>;
  broadcast(
    context: TransactionPrepareContext<TNamespace>,
    signed: SignedTransactionPayload,
    prepared: TransactionPrepared<TNamespace>,
  ): Promise<{
    submitted: TransactionSubmitted<TNamespace>;
  }>;
};

export type NamespaceTransactionSubmission<TNamespace extends string = string> = {
  createBroadcastInput(
    context: TransactionBroadcastInputContext<TNamespace>,
    options?: TransactionSignOptions,
  ): Promise<BroadcastInput>;
  broadcast(context: TransactionBroadcastContext<TNamespace>): Promise<BroadcastResult<TNamespace>>;
};

export type NamespaceTransactionTracking<TNamespace extends string = string> = {
  // Legacy tracking contract kept for the old transaction runtime.
  fetchReceipt?(context: TransactionTrackingContext<TNamespace>): Promise<ReceiptResolution<TNamespace> | null>;
  detectReplacement?(context: TransactionTrackingContext<TNamespace>): Promise<ReplacementResolution | null>;
  deriveReplacementKey?(context: TransactionTrackingContext<TNamespace>): TransactionReplacementKey | null;

  // New aggregate-centric tracking contract.
  inspectSubmittedTransaction?(
    context: TransactionTrackingContext<TNamespace>,
  ): Promise<SubmittedTransactionInspection<TNamespace>>;
};

export type NamespaceTransactionRecord<TNamespace extends string = string> = {
  parseSubmitted(submitted: TransactionSubmitted<TNamespace>): TransactionSubmitted<TNamespace>;
  parseReceipt(receipt: TransactionReceipt<TNamespace>): TransactionReceipt<TNamespace>;
};

export type NamespaceTransaction<TNamespace extends string = string> = {
  request?: NamespaceTransactionRequest<TNamespace>;
  proposal?: NamespaceTransactionProposal<TNamespace>;
  execution?: NamespaceTransactionExecution<TNamespace>;
  submission?: NamespaceTransactionSubmission<TNamespace>;
  tracking?: NamespaceTransactionTracking<TNamespace>;
  record?: NamespaceTransactionRecord<TNamespace>;
};

export type AnyNamespaceTransaction = NamespaceTransaction<string>;
