import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { ApprovalKinds, ApprovalRequestByKind } from "../../controllers/approval/types.js";
import type { NamespaceTransactionReview } from "../../controllers/transaction/review/types.js";
import type { TransactionMeta } from "../../controllers/transaction/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type {
  TransactionIssue,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionWarning,
} from "../types.js";

export type PreparedTransactionResult<TPrepared = Record<string, unknown>> = {
  prepared: TPrepared;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type SignedTransactionPayload = {
  raw: string;
  hash: string | null;
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

export type TransactionTrackingContext = TransactionPrepareContext & {
  prepared: TransactionPrepared | null;
};

export type ReceiptResolution =
  | { status: "success"; receipt: TransactionReceipt }
  | { status: "failed"; receipt: TransactionReceipt };

export type ReplacementResolution = {
  hash: string | null;
  status: "replaced";
};

export type TransactionRequestDeriver = (request: TransactionRequest, chainRef: ChainRef) => TransactionRequest;

export type TransactionApprovalReviewContext = {
  transaction: TransactionMeta | undefined;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
};

export type TransactionDraftEditContext = {
  transaction: TransactionMeta;
  request: TransactionRecord["request"];
  changes: Record<string, unknown>[];
  mode?: string | undefined;
};

export type TransactionReceiptTrackingAdapter = {
  fetchReceipt(context: TransactionTrackingContext, hash: string): Promise<ReceiptResolution | null>;
  detectReplacement?(context: TransactionTrackingContext): Promise<ReplacementResolution | null>;
};

export type TransactionSubmissionAdapter = {
  validateRequest?(context: TransactionValidationContext): void;
  prepareTransaction(context: TransactionPrepareContext): Promise<PreparedTransactionResult>;
  signTransaction(
    context: TransactionSignContext,
    prepared: PreparedTransactionResult["prepared"],
  ): Promise<SignedTransactionPayload>;
  broadcastTransaction(context: TransactionPrepareContext, signed: SignedTransactionPayload): Promise<{ hash: string }>;
};

export type TransactionAdapter = {
  deriveRequestForChain?(request: TransactionRequest, chainRef: ChainRef): TransactionRequest;
  buildApprovalReview?(context: TransactionApprovalReviewContext): NamespaceTransactionReview | null;
  applyDraftEdit?(context: TransactionDraftEditContext): TransactionRecord["request"];
  receiptTracking?: TransactionReceiptTrackingAdapter;
} & TransactionSubmissionAdapter;
