import type { ChainRef } from "../../chains/ids.js";
import type { JsonValue, TransactionTerminalReason } from "../aggregate/index.js";
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
  review: TransactionReviewDetails | null;
  preparedAt: number;
  expiresAt: number | null;
};

export type TransactionApprovalBlockedState = TransactionApprovalPrepareBase & {
  status: "blocked";
  blocker: TransactionProposalBlocker;
  approvedPayload: null;
  review: TransactionReviewDetails | null;
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
  transactionId: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  accountKey: string;
  from: string;
  draft: TransactionApprovalDraft;
  prepare: TransactionApprovalPrepareState;
};

export type OpenTransactionApprovalSessionInput = {
  transactionId: string;
  approvalId: string;
};

export type PrepareTransactionApprovalSessionInput = {
  transactionId: string;
  approvalId: string;
};

export type EditTransactionApprovalSessionInput = {
  transactionId: string;
  approvalId: string;
  edit: NamespaceTransactionDraftEdit;
  mode?: string;
};

export type ApproveTransactionApprovalSessionInput = {
  transactionId: string;
  approvalId: string;
};

export type ResolveTransactionApprovalSessionInput = {
  transactionId: string;
  approvalId: string;
  reason?: TransactionTerminalReason | null;
};
