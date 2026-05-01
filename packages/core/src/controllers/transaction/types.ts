import type { Hex } from "ox/Hex";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { TransactionStatus as StorageTransactionStatus } from "../../storage/records.js";
import type {
  TransactionError,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmissionLocator,
  TransactionSubmitted,
} from "../../transactions/types.js";
import type { ApprovalCreateParams, ApprovalHandle, ApprovalKind, ApprovalKinds } from "../approval/types.js";
import type {
  SendTransactionApprovalReview,
  TransactionReviewBlocker,
  TransactionReviewError,
  TransactionReviewRuntimeStatus,
} from "./review/types.js";

export type TransactionProposalPhase = "pending" | "approved" | "invalidated" | "failed";
export type TransactionRecordStatus = StorageTransactionStatus;

export type TransactionApprovalChainMetadata = {
  chainRef: ChainRef;
  namespace: string;
  name: string;
  shortName?: string | null;
  chainId?: Hex | null;
  nativeCurrency?: {
    symbol: string;
    decimals: number;
  } | null;
};

export type TransactionProposalPhaseChange = {
  kind: "proposal_phase";
  id: string;
  previousPhase: TransactionProposalPhase;
  nextPhase: TransactionProposalPhase;
  proposal: TransactionProposalView;
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
  revision: number;
  transactionIds: string[];
};

export type TransactionSubmittedChange = {
  id: string;
  submitted: TransactionSubmitted;
  locator: TransactionSubmissionLocator;
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
  locator?: never;
  receipt?: never;
  replacedId?: never;
  error: TransactionError | null;
  userRejected: boolean;
};

export type TransactionProposalView = {
  kind: "proposal";
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  fromAccountKey: string;
  from: AccountAddress | null;
  baseRequest: TransactionRequest;
  currentRequest: TransactionRequest;
  draftRevision: number;
  prepared: TransactionPrepared | null;
  reviewState: {
    sessionToken: string | null;
    status: TransactionReviewRuntimeStatus | null;
    reviewPreparedSnapshot: TransactionPrepared | null;
    blocker: TransactionReviewBlocker | null;
    error: TransactionReviewError | null;
    invalidatedBy?: string | undefined;
    updatedAt: number;
  };
  review: SendTransactionApprovalReview;
  phase: TransactionProposalPhase;
  failure: {
    error: TransactionError | null;
    userRejected: boolean;
  } | null;
  createdAt: number;
  updatedAt: number;
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
  locator: TransactionSubmissionLocator;
  receipt: TransactionReceipt | null;
  replacedId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionView = TransactionProposalView | TransactionRecordView;

export type TransactionApprovalRequestPayload = {
  chainRef: ChainRef;
  origin: string;
  chain?: TransactionApprovalChainMetadata | null;
  from: AccountAddress | null;
  request: TransactionRequest;
};

export type TransactionApprovalRequest = ApprovalCreateParams<typeof ApprovalKinds.SendTransaction>;

export type TransactionApprovalRequestHandoff = {
  transactionId: string;
  approvalId: string;
  pendingView: TransactionProposalView;
  waitForApprovalDecision(): Promise<TransactionView>;
};

export type TransactionApprovalHandoff = TransactionApprovalRequestHandoff & {
  waitForProviderCompletion(): Promise<TransactionSubmissionResolution>;
};

export type TransactionApproveFailureReason =
  | "not_found"
  | "not_pending"
  | "prepare_not_ready"
  | "prepare_blocked"
  | "prepare_failed";

export type TransactionApproveResult =
  | { status: "approved"; transaction: TransactionProposalView }
  | {
      status: "failed";
      reason: TransactionApproveFailureReason;
      transaction?: TransactionProposalView | undefined;
      message: string;
      data?: unknown;
    };

export type BeginTransactionApprovalOptions = {
  from: AccountAddress;
  requestBinding?: TransactionRequestBinding | null;
};

export type TransactionSubmissionResolution = {
  submitted: TransactionSubmitted;
  locator: TransactionSubmissionLocator;
};

export type TransactionSubmissionOutcome =
  | { state: "submitted"; resolution: TransactionSubmissionResolution }
  | { state: "failed"; error: TransactionSubmissionError };

export class TransactionSubmissionError extends Error {
  readonly proposal: TransactionProposalView;

  constructor(proposal: TransactionProposalView) {
    super(proposal.failure?.error?.message ?? "Transaction submission failed");
    this.name = "TransactionSubmissionError";
    this.proposal = proposal;
  }
}

export const isTransactionSubmissionError = (error: unknown): error is TransactionSubmissionError =>
  error instanceof TransactionSubmissionError;

export type TransactionController = {
  getView(id: string): TransactionView | undefined;
  getApprovalReview(input: {
    transactionId: string;
    request?: TransactionApprovalRequestPayload | undefined;
  }): SendTransactionApprovalReview;
  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff>;
  retryPrepare(transactionId: string): Promise<void>;
  applyDraftEdit(input: {
    transactionId: string;
    changes: ReadonlyArray<Record<string, unknown>>;
    mode?: string;
  }): Promise<void>;
  waitForTransactionSubmission(id: string): Promise<TransactionSubmissionResolution>;
  approveTransaction(id: string): Promise<TransactionApproveResult>;
  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void>;
  resumePending(): Promise<void>;
  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void;
  onStateChanged(handler: (change: TransactionStateChange) => void): () => void;
};

export type {
  Eip155SubmittedTransaction,
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionRequest,
  TransactionError,
  TransactionPayload,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmissionLocator,
  TransactionSubmitted,
} from "../../transactions/types.js";
