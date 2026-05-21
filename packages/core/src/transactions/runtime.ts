import type { ChainRef } from "../chains/ids.js";
import type { AccountAddress } from "../controllers/account/types.js";
import type { RequestContext } from "../rpc/requestContext.js";
import type { TransactionAccess } from "./access.js";
import type { TransactionIntent } from "./intent/index.js";
import type {
  TransactionProposal,
  TransactionProposalStatus,
  TransactionProposalTermination,
  TransactionProposalTerminationReason,
} from "./proposal/index.js";
import type { TransactionRecordStatus, TransactionRecordView } from "./record/index.js";
import type { SendTransactionApprovalReview } from "./review/types.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionError,
  TransactionPrepared,
  TransactionRequest,
  TransactionSubmitted,
} from "./types.js";

export type TransactionProposalStatusChange = {
  kind: "proposal_status";
  id: string;
  previousStatus: TransactionProposalStatus;
  nextStatus: TransactionProposalStatus;
  proposal: ControllerTransactionProposalSnapshot;
};

export type TransactionRecordStatusChange = {
  kind: "record_status";
  id: string;
  previousStatus: TransactionRecordStatus | null;
  nextStatus: TransactionRecordStatus;
  record: TransactionRecordView;
};

export type TransactionStatusChange = TransactionProposalStatusChange | TransactionRecordStatusChange;

export type ApprovalDetailInvalidation = {
  approvalIds: string[];
};

export type TransactionSubmittedChange = {
  id: string;
  submitted: TransactionSubmitted;
};

export type TransactionBroadcastStartedChange = {
  id: string;
};

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

type TransactionMetaBase = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalMeta = TransactionMetaBase & {
  approvalId: string;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  submitted?: never;
  receipt?: never;
  replacedByRecordId?: never;
};

export type TransactionProposalPrepareSnapshot = {
  requestRevision: number;
  sessionToken: string;
  status: TransactionProposal["prepare"]["status"];
  prepared: TransactionPrepared | null;
  reviewSnapshot: TransactionPrepared | null;
  blocker?: TransactionProposal["prepare"]["blocker"];
  error?: TransactionProposal["prepare"]["error"];
  invalidatedBy?: string | undefined;
};

export type TransactionProposalStateSnapshot = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  request: TransactionRequest;
  fromAccountKey: string;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  createdAt: number;
  updatedAt: number;
  prepare: TransactionProposalPrepareSnapshot;
};

export type TransactionReviewRuntimeStatus = "preparing" | "ready" | "blocked" | "failed" | "invalidated";

export type TransactionProposalReviewState = {
  sessionToken: string;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  reviewPreparedSnapshot: TransactionPrepared | null;
  error: TransactionProposal["prepare"]["error"] | null;
  blocker: TransactionProposal["prepare"]["blocker"] | null;
  invalidatedBy?: string | undefined;
};

export type ControllerTransactionProposalSnapshot = {
  kind: "proposal";
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress;
  requestedAddress?: string | undefined;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionProposalStatus;
  termination?: TransactionProposalTermination | undefined;
  createdAt: number;
  updatedAt: number;
};

export type ControllerTransactionProposalView = ControllerTransactionProposalSnapshot & {
  review?: SendTransactionApprovalReview | undefined;
};

export type { TransactionProposalTerminationReason, TransactionRecordStatus, TransactionRecordView };

export type TransactionApprovalRequestRef = {
  transactionId: string;
  approvalId: string;
};

export type ProviderTransactionSubmission = TransactionApprovalRequestRef & {
  waitForSubmission(): Promise<TransactionSubmissionResolution>;
};

export type TransactionApprovalFailureReason =
  | "not_found"
  | "not_pending"
  | "prepare_not_ready"
  | "prepare_blocked"
  | "prepare_failed";

export type TransactionApprovalResult =
  | { status: "approved"; transactionId: string }
  | {
      status: "failed";
      reason: TransactionApprovalFailureReason;
      transaction?: ControllerTransactionProposalSnapshot | undefined;
      message: string;
      data?: unknown;
    };

export type BeginTransactionApprovalOptions = {
  requestBinding?: TransactionRequestBinding | null;
};

export type TransactionSubmissionResolution = {
  submitted: TransactionSubmitted;
  persistenceFailure?: TransactionSubmissionPersistenceFailure | undefined;
};

export type TransactionSubmissionPersistenceFailure = {
  transactionId: string;
  error: TransactionError;
  submitted: TransactionSubmitted;
};

export type TransactionSubmissionFailure = {
  transactionId: string;
  error: TransactionError | null;
  terminationReason: TransactionProposalTerminationReason;
  userRejected: boolean;
  message: string;
};

export class TransactionSubmissionError extends Error {
  readonly failure: TransactionSubmissionFailure;

  constructor(failure: TransactionSubmissionFailure) {
    super(failure.message);
    this.name = "TransactionSubmissionError";
    this.failure = structuredClone(failure);
  }
}

export class TransactionSubmissionPersistenceError extends Error {
  readonly failure: TransactionSubmissionPersistenceFailure;

  constructor(failure: TransactionSubmissionPersistenceFailure) {
    super(failure.error.message);
    this.name = "TransactionSubmissionPersistenceError";
    this.failure = structuredClone(failure);
  }
}

export const isTransactionSubmissionError = (error: unknown): error is TransactionSubmissionError =>
  error instanceof TransactionSubmissionError;

export const isTransactionSubmissionPersistenceError = (
  error: unknown,
): error is TransactionSubmissionPersistenceError => error instanceof TransactionSubmissionPersistenceError;

export type TransactionApprovalReviewReader = {
  getTransactionApprovalReview(transactionId: string): SendTransactionApprovalReview;
};

export type TransactionProposalBeginCommands = {
  createProposal(intent: TransactionIntent, requestContext: RequestContext): TransactionProposalMeta;
  requestApproval(
    proposalMeta: TransactionProposalMeta,
    requestContext: RequestContext,
    requestBinding?: TransactionRequestBinding | null,
  ): string;
  beginTransactionApproval(
    intent: TransactionIntent,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalRequestRef>;
};

export type TransactionProposalDraftCommands = {
  rerunPrepare(transactionId: string): Promise<void>;
  applyDraftEdit(input: { transactionId: string; edit: NamespaceTransactionDraftEdit; mode?: string }): Promise<void>;
};

export type TransactionProposalCommandSet = Readonly<{
  begin: TransactionProposalBeginCommands;
  draft: TransactionProposalDraftCommands;
}>;

export type ProviderTransactionApprovalCommands = {
  beginTransactionApproval(
    intent: TransactionIntent,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<ProviderTransactionSubmission>;
};

export type TransactionSubmissionTracker = {
  waitForSubmissionOutcome(id: string): Promise<TransactionSubmissionResolution>;
};

export type TransactionApprovalExecutor = {
  approveTransaction(id: string): Promise<TransactionApprovalResult>;
  rejectTransaction(input: {
    id: string;
    reason?: Error | TransactionError;
    terminationReason: TransactionProposalTerminationReason;
  }): Promise<void>;
};

export type TransactionRecoveryRuntime = {
  resumeTransactions(): Promise<void>;
};

export type ApprovalDetailInvalidationEvents = {
  onChanged(handler: (change: ApprovalDetailInvalidation) => void): () => void;
};

export type TransactionProposalReader = {
  getProposalView(id: string): ControllerTransactionProposalView | undefined;
};

export type TransactionProposalRuntimeReader = {
  getProposalStateSnapshot(id: string): TransactionProposalStateSnapshot | undefined;
  getView(id: string): ControllerTransactionProposalSnapshot | undefined;
  getReviewState(id: string): TransactionProposalReviewState | null;
  onChanged(handler: (transactionIds: string[]) => void): () => void;
};

export type TransactionRecordReader = {
  getRecordView(id: string): TransactionRecordView | undefined;
  getOrLoadRecordView(id: string): Promise<TransactionRecordView | null>;
  onChanged(handler: (transactionIds: string[]) => void): () => void;
};

export type TransactionRuntime = Readonly<{
  access: TransactionAccess;
  proposal: TransactionProposalCommandSet;
  providerCommands: ProviderTransactionApprovalCommands;
  execution: TransactionApprovalExecutor;
  recovery: TransactionRecoveryRuntime;
  submission: TransactionSubmissionTracker;
  approvalDetailInvalidations: ApprovalDetailInvalidationEvents;
  review: TransactionApprovalReviewReader;
  proposals: TransactionProposalReader;
  records: TransactionRecordReader;
}>;
