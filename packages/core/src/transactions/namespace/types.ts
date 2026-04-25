import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { ApprovalKinds, ApprovalRequestByKind } from "../../controllers/approval/types.js";
import type { NamespaceTransactionReview } from "../../controllers/transaction/review/types.js";
import type { TransactionMeta } from "../../controllers/transaction/types.js";
import type {
  TransactionIssue,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmissionLocator,
  TransactionSubmitted,
  TransactionWarning,
} from "../types.js";

export type PreparedTransactionResult<TPrepared = Record<string, unknown>> = {
  prepared: TPrepared;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

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
  prepare(context: TransactionPrepareContext): Promise<PreparedTransactionResult>;
  buildReview?(context: TransactionApprovalReviewContext): NamespaceTransactionReview | null;
  applyDraftEdit?(context: TransactionDraftEditContext): TransactionRequest;
};

export type NamespaceTransactionExecution = {
  sign(
    context: TransactionSignContext,
    prepared: PreparedTransactionResult["prepared"],
  ): Promise<SignedTransactionPayload>;
  broadcast(
    context: TransactionPrepareContext,
    signed: SignedTransactionPayload,
    prepared: PreparedTransactionResult["prepared"],
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
