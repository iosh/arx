import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { TransactionStatus as StorageTransactionStatus } from "../../storage/records.js";
import type {
  NamespaceTransactionDraftEdit,
  TransactionError,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmitted,
} from "../../transactions/types.js";
import type { ApprovalHandle, ApprovalKind } from "../approval/types.js";
import type { SendTransactionApprovalReview } from "./review/types.js";

export type TransactionProposalPhase = "pending" | "approved" | "failed";
export type TransactionRecordStatus = StorageTransactionStatus;

export type TransactionProposalPhaseChange = {
  kind: "proposal_phase";
  id: string;
  previousPhase: TransactionProposalPhase;
  nextPhase: TransactionProposalPhase;
  proposal: TransactionProposalSnapshot;
};

export type TransactionRecordStatusChange = {
  kind: "record_status";
  id: string;
  previousStatus: TransactionRecordStatus | null;
  nextStatus: TransactionRecordStatus;
  record: TransactionRecordView;
};

export type TransactionStatusChange = TransactionProposalPhaseChange | TransactionRecordStatusChange;

export type TransactionStateChange = {
  transactionIds: string[];
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
  id: string;
  signal?: AbortSignal | null;
  attachBlockingApproval<K extends ApprovalKind>(
    createApproval: (reservation: TransactionApprovalReservation) => ApprovalHandle<K>,
    reservation?: Partial<TransactionApprovalReservation>,
  ): ApprovalHandle<K>;
};

type TransactionMetaBase = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalMeta = TransactionMetaBase & {
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionProposalPhase;
  submitted?: never;
  receipt?: never;
  replacedId?: never;
  error: TransactionError | null;
  userRejected: boolean;
};

export type TransactionReviewRuntimeStatus = "preparing" | "ready" | "blocked" | "failed" | "invalidated";

export type TransactionProposalReviewState = {
  sessionToken: string;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  reviewPreparedSnapshot: TransactionPrepared | null;
  error: import("./review/types.js").TransactionReviewError | null;
  blocker: import("./review/types.js").TransactionReviewBlocker | null;
  invalidatedBy?: string | undefined;
};

export type TransactionProposalSnapshot = {
  kind: "proposal";
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  currentRequest: TransactionRequest;
  prepared: TransactionPrepared | null;
  phase: TransactionProposalPhase;
  failure: {
    error: TransactionError | null;
    userRejected: boolean;
  } | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionProposalView = TransactionProposalSnapshot & {
  review: SendTransactionApprovalReview;
};

export type TransactionRecordView = {
  kind: "record";
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  status: TransactionRecordStatus;
  submitted: TransactionSubmitted;
  receipt: TransactionReceipt | null;
  replacedId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SendTransactionApprovalSubjectRequest = {
  transactionId: string;
  chainRef: ChainRef;
  origin: string;
};

export type TransactionApprovalRequestHandoff = {
  transactionId: string;
  approvalId: string;
};

export type TransactionApprovalHandoff = TransactionApprovalRequestHandoff & {
  waitForProviderCompletion(): Promise<TransactionSubmissionResolution>;
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
      transaction?: TransactionProposalSnapshot | undefined;
      message: string;
      data?: unknown;
    };

export type BeginTransactionApprovalOptions = {
  from: AccountAddress;
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
  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalRequestHandoff>;
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
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff>;
};

export type TransactionSubmissionTracker = {
  waitForSubmissionOutcome(id: string): Promise<TransactionSubmissionResolution>;
};

export type TransactionApprovalExecutor = {
  approveTransaction(id: string): Promise<TransactionApprovalResult>;
  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void>;
};

export type TransactionRecovery = {
  resumeTransactions(): Promise<void>;
};

export type TransactionStateChangeEvents = {
  onStateChanged(handler: (change: TransactionStateChange) => void): () => void;
};

export type TransactionProposalReader = {
  getProposalView(id: string): TransactionProposalView | undefined;
};

export type TransactionProposalRuntimeReader = {
  getProposalView(id: string): TransactionProposalSnapshot | undefined;
  getReviewState(id: string): TransactionProposalReviewState | null;
};

export type TransactionRecordReader = {
  getRecordView(id: string): TransactionRecordView | undefined;
};

export type TransactionRuntime = Readonly<{
  proposal: TransactionProposalCommandSet;
  providerCommands: ProviderTransactionApprovalCommands;
  execution: TransactionApprovalExecutor;
  recovery: TransactionRecovery;
  submission: TransactionSubmissionTracker;
  stateChanges: TransactionStateChangeEvents;
  review: TransactionApprovalReviewReader;
  proposals: TransactionProposalReader;
  records: TransactionRecordReader;
}>;

export type { SendTransactionApprovalReview } from "./review/types.js";
