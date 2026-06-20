import type { ChainRef } from "../../chains/ids.js";
import type {
  CreateTransactionReplacementInput,
  JsonValue,
  TransactionRequestSnapshot,
  TransactionSource,
} from "../aggregate/index.js";
import type { TransactionAggregate } from "../aggregate/types.js";
import type { TransactionProposalBlocker, TransactionProposalError } from "../namespace/types.js";
import type { TransactionReviewDetails } from "../review.js";
import type { NamespaceTransactionDraftEdit } from "../types.js";

export type TransactionApprovalDraft = {
  payload: JsonValue;
  revision: number;
  updatedAt: number;
};

type TransactionApprovalPrepareBase = {
  draftRevision: number;
  prepareId: string;
  updatedAt: number;
};

export type TransactionApprovalPreparingState = TransactionApprovalPrepareBase & {
  status: "preparing";
};

export type TransactionApprovalReadyState = TransactionApprovalPrepareBase & {
  status: "ready";
  approvedPayload: JsonValue;
  preparedAt: number;
  expiresAt: number | null;
};

export type TransactionApprovalBlockedState = TransactionApprovalPrepareBase & {
  status: "blocked";
  blocker: TransactionProposalBlocker;
  approvedPayload: null;
  expiresAt: number | null;
};

export type TransactionApprovalFailedState = TransactionApprovalPrepareBase & {
  status: "failed";
  error: TransactionProposalError;
};

export type TransactionApprovalPrepareState =
  | TransactionApprovalPreparingState
  | TransactionApprovalReadyState
  | TransactionApprovalBlockedState
  | TransactionApprovalFailedState;

export type TransactionApprovalSession = {
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  accountKey: string;
  from: string;
  requestId: string | null;
  replacement: CreateTransactionReplacementInput | null;
  createdAt: number;
  draft: TransactionApprovalDraft;
  review: TransactionReviewDetails | null;
  prepare: TransactionApprovalPrepareState;
};

export type ApprovedTransactionApprovalSessionResult = {
  status: "approved";
  aggregate: TransactionAggregate;
};

export type ApprovalStaleTransactionApprovalSessionResult = {
  status: "approval_stale";
  session: TransactionApprovalSession | null;
  stale: {
    reason: string;
    message: string;
    data?: unknown;
  };
};

export type BlockedTransactionApprovalSessionResult = {
  status: "blocked";
  session: TransactionApprovalSession;
  blocker: TransactionProposalBlocker;
};

export type FailedTransactionApprovalSessionResult = {
  status: "failed";
  session: TransactionApprovalSession;
  error: TransactionProposalError;
};

export type ApproveTransactionApprovalSessionResult =
  | ApprovedTransactionApprovalSessionResult
  | ApprovalStaleTransactionApprovalSessionResult
  | BlockedTransactionApprovalSessionResult
  | FailedTransactionApprovalSessionResult;

export type OpenTransactionApprovalSessionInput = {
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  accountKey: string;
  from: string;
  requestId?: string | null;
  request: TransactionRequestSnapshot;
  replacement: CreateTransactionReplacementInput | null;
};

export type PrepareTransactionApprovalSessionInput = {
  approvalId: string;
};

export type EditTransactionApprovalSessionInput = {
  approvalId: string;
  edit: NamespaceTransactionDraftEdit;
  mode?: string;
};

export type ApproveTransactionApprovalSessionInput = {
  approvalId: string;
  expectedPrepareId: string;
};

export type ResolveTransactionApprovalSessionInput = {
  approvalId: string;
};
