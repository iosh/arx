import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { NamespaceTransactionReview } from "../review.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
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
  from: AccountAddress | null;
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
  replacedId?: string | null;
  status: "replaced";
};

export type TransactionApprovalReviewContext<TNamespace extends string = string> = {
  transactionId: string;
  namespace: TNamespace;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest<TNamespace>;
  reviewPreparedSnapshot: TransactionPrepared<TNamespace> | null;
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

export type NamespaceTransactionRequest<TNamespace extends string = string> = {
  deriveForChain?(request: TransactionRequest<TNamespace>, chainRef: ChainRef): TransactionRequest<TNamespace>;
  validateRequest?(context: TransactionValidationContext<TNamespace>): void;
};

export type NamespaceTransactionProposal<TNamespace extends string = string> = {
  prepare(
    context: TransactionPrepareContext<TNamespace>,
  ): Promise<TransactionPrepareResult<TransactionPrepared<TNamespace>>>;
  buildReview?(context: TransactionApprovalReviewContext<TNamespace>): NamespaceTransactionReview | null;
  applyDraftEdit?(context: TransactionDraftEditContext<TNamespace>): TransactionRequest<TNamespace>;
};

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

export type NamespaceTransactionTracking<TNamespace extends string = string> = {
  fetchReceipt(context: TransactionTrackingContext<TNamespace>): Promise<ReceiptResolution<TNamespace> | null>;
  detectReplacement?(context: TransactionTrackingContext<TNamespace>): Promise<ReplacementResolution | null>;
  deriveReplacementKey?(context: TransactionTrackingContext<TNamespace>): TransactionReplacementKey | null;
};

export type NamespaceTransaction<TNamespace extends string = string> = {
  request?: NamespaceTransactionRequest<TNamespace>;
  proposal?: NamespaceTransactionProposal<TNamespace>;
  execution?: NamespaceTransactionExecution<TNamespace>;
  tracking?: NamespaceTransactionTracking<TNamespace>;
};

export type AnyNamespaceTransaction = NamespaceTransaction<string>;
