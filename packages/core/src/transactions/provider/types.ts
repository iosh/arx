import type { ApprovalRequester } from "../../controllers/approval/types.js";
import type { TransactionIntent } from "../intent/index.js";
import type { TransactionSubmissionResolution } from "../orchestration/types.js";

export type TransactionApprovalIdentity = {
  approvalId: string;
  createdAt: number;
};

export type TransactionRequestScope = {
  abortSignal?: AbortSignal | null;
};

export type TransactionApprovalRequestRef = {
  transactionId: string;
  approvalId: string;
};

export type BeginTransactionApprovalOptions = {
  approvalIdentity?: TransactionApprovalIdentity | null;
  requestScope?: TransactionRequestScope | null;
};

export type ProviderTransactionSubmission = TransactionApprovalRequestRef & {
  waitForSubmission(): Promise<TransactionSubmissionResolution>;
};

export type ProviderTransactionApprovalCommands = {
  beginTransactionApproval(
    intent: TransactionIntent,
    requester: ApprovalRequester,
    options: BeginTransactionApprovalOptions,
  ): ProviderTransactionSubmission;
};
