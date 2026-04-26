import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { ApprovalKinds, ApprovalRequestByKind } from "../../controllers/approval/types.js";
import type { NamespaceTransactionReview } from "../../controllers/transaction/review/types.js";
import type { TransactionMeta } from "../../controllers/transaction/types.js";
import type {
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmissionLocator,
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

export type TransactionPrepareResult<TPrepared = TransactionPrepared> =
  | { status: "ready"; prepared: TPrepared }
  | { status: "blocked"; blocker: TransactionProposalBlocker; prepared?: TPrepared | null }
  | { status: "failed"; error: TransactionProposalError; prepared?: TPrepared | null };

export type SignedTransactionPayload = {
  raw: string;
};

export type TransactionPrepareContext = {
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
};

export type TransactionValidationContext = TransactionPrepareContext;

export type TransactionSignContext = Omit<TransactionPrepareContext, "from"> & { from: AccountAddress };

export type TransactionTrackingContext = Omit<TransactionPrepareContext, "request"> & {
  request: TransactionRequest | null;
  submitted: TransactionSubmitted;
  locator: TransactionSubmissionLocator;
};

export type TransactionReplacementKey = {
  scope: string;
  value: string;
};

export type ReceiptResolution =
  | { status: "success"; receipt: TransactionReceipt }
  | { status: "failed"; receipt: TransactionReceipt };

export type ReplacementResolution = {
  replacedId?: string | null;
  status: "replaced";
};

export type TransactionRequestDeriver = (request: TransactionRequest, chainRef: ChainRef) => TransactionRequest;

export type TransactionApprovalReviewContext = {
  transaction: TransactionMeta | undefined;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
  reviewPreparedSnapshot?: TransactionPrepared | null;
};

export type TransactionDraftEditContext = {
  transaction: TransactionMeta;
  request: TransactionRequest;
  changes: Record<string, unknown>[];
  mode?: string | undefined;
};

export type NamespaceTransactionRequest = {
  deriveForChain?(request: TransactionRequest, chainRef: ChainRef): TransactionRequest;
  validate?(context: TransactionValidationContext): void;
};

export type NamespaceTransactionProposal = {
  prepare(context: TransactionPrepareContext): Promise<TransactionPrepareResult>;
  buildReview?(context: TransactionApprovalReviewContext): NamespaceTransactionReview | null;
  applyDraftEdit?(context: TransactionDraftEditContext): TransactionRequest;
};

export type NamespaceTransactionExecution = {
  sign(context: TransactionSignContext, prepared: TransactionPrepared): Promise<SignedTransactionPayload>;
  broadcast(
    context: TransactionPrepareContext,
    signed: SignedTransactionPayload,
    prepared: TransactionPrepared,
  ): Promise<{
    submitted: TransactionSubmitted;
    locator: TransactionSubmissionLocator;
  }>;
};

export type NamespaceTransactionTracking = {
  fetchReceipt(context: TransactionTrackingContext): Promise<ReceiptResolution | null>;
  detectReplacement?(context: TransactionTrackingContext): Promise<ReplacementResolution | null>;
  deriveReplacementKey?(context: TransactionTrackingContext): TransactionReplacementKey | null;
};

export type NamespaceTransaction = {
  request?: NamespaceTransactionRequest;
  proposal?: NamespaceTransactionProposal;
  execution?: NamespaceTransactionExecution;
  tracking?: NamespaceTransactionTracking;
};
export type { TransactionSubmissionLocator, TransactionSubmitted } from "../types.js";
