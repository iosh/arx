import type { Hex } from "ox/Hex";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type { ProviderRequestHandle } from "../../runtime/provider/providerRequests.js";
import type { TransactionStatus as StorageTransactionStatus } from "../../storage/records.js";
import type {
  TransactionError,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionSubmissionLocator,
  TransactionSubmitted,
} from "../../transactions/types.js";
import type { ApprovalCreateParams, ApprovalKinds } from "../approval/types.js";
import type { SendTransactionApprovalReview } from "./review/types.js";

export type TransactionStatus = "pending" | "approved" | "signed" | "broadcast" | "confirmed" | "failed" | "replaced";
export type DurableTransactionStatus = Exclude<TransactionStatus, "pending" | "approved" | "signed">;
export type TransactionRecordStatus = StorageTransactionStatus;

export type TransactionProposalPhase = "pending" | "approved" | "executing" | "invalidated" | "failed";

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

export type TransactionStatusChange = {
  id: string;
  previousStatus: TransactionStatus;
  nextStatus: TransactionStatus;
  meta: TransactionMeta;
};

export type TransactionStateChange = {
  revision: number;
  transactionIds: string[];
};

export type TransactionMeta = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest | null;
  prepared: TransactionPrepared | null;
  status: TransactionStatus;
  submitted: TransactionSubmitted | null;
  locator: TransactionSubmissionLocator | null;
  receipt: TransactionReceipt | null;
  replacedId: string | null;
  error: TransactionError | null;
  userRejected: boolean;
  createdAt: number;
  updatedAt: number;
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
  review: SendTransactionApprovalReview;
  phase: TransactionProposalPhase;
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

export type TransactionApprovalHandoff = {
  transactionId: string;
  approvalId: string;
  pendingMeta: TransactionMeta;
  waitForApprovalDecision(): Promise<TransactionMeta>;
};

export type TransactionApproveFailureReason =
  | "not_found"
  | "not_pending"
  | "prepare_not_ready"
  | "prepare_blocked"
  | "prepare_failed";

export type TransactionApproveResult =
  | { status: "approved"; transaction: TransactionMeta }
  | {
      status: "failed";
      reason: TransactionApproveFailureReason;
      transaction?: TransactionMeta | undefined;
      message: string;
      data?: unknown;
    };

export type BeginTransactionApprovalOptions = {
  from: AccountAddress;
  providerRequestHandle?: ProviderRequestHandle | null;
};

export type TransactionSubmissionResolution = {
  locator: TransactionSubmissionLocator;
  meta: TransactionMeta;
};

export class TransactionSubmissionError extends Error {
  readonly meta: TransactionMeta;

  constructor(meta: TransactionMeta) {
    super(meta.error?.message ?? "Transaction submission failed");
    this.name = "TransactionSubmissionError";
    this.meta = meta;
  }
}

export const isTransactionSubmissionError = (error: unknown): error is TransactionSubmissionError =>
  error instanceof TransactionSubmissionError;

export type TransactionController = {
  getMeta(id: string): TransactionMeta | undefined;
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
