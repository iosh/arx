import type { ApprovalRequester } from "../../controllers/approval/types.js";
import type { TransactionIntent } from "../intent/index.js";
import type { TransactionSubmissionResolution } from "../orchestration/types.js";

export type TransactionApprovalReservation = {
  approvalId: string;
  createdAt: number;
};

export type TransactionRequestBinding = {
  abortSignal?: AbortSignal | null;
  attachBlockingApproval<T>(
    createApproval: (reservation: TransactionApprovalReservation) => T,
    reservation?: Partial<TransactionApprovalReservation>,
  ): T & TransactionApprovalReservation;
};

export type TransactionApprovalRequestRef = {
  transactionId: string;
  approvalId: string;
};

export type BeginTransactionApprovalOptions = {
  requestBinding?: TransactionRequestBinding | null;
};

export type ProviderTransactionSubmission = TransactionApprovalRequestRef & {
  waitForSubmission(): Promise<TransactionSubmissionResolution>;
};

export type ProviderTransactionApprovalCommands = {
  beginTransactionApproval(
    intent: TransactionIntent,
    requester: ApprovalRequester,
    options: BeginTransactionApprovalOptions,
  ): Promise<ProviderTransactionSubmission>;
};
