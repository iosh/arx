import type { Hex } from "ox/Hex";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountAddress } from "../../controllers/account/types.js";
import type { RequestContext } from "../../rpc/requestContext.js";
import type {
  TransactionError,
  TransactionIssue,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionWarning,
} from "../../transactions/types.js";
import type { ApprovalCreateParams, ApprovalKinds } from "../approval/types.js";

export type TransactionStatus = "pending" | "approved" | "signed" | "broadcast" | "confirmed" | "failed" | "replaced";

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
};

export type TransactionMeta = {
  id: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  from: AccountAddress | null;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  status: TransactionStatus;
  hash: string | null;
  receipt: TransactionReceipt | null;
  error: TransactionError | null;
  userRejected: boolean;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
  createdAt: number;
  updatedAt: number;
};

export type TransactionApprovalRequestPayload = {
  chainRef: ChainRef;
  origin: string;
  chain?: TransactionApprovalChainMetadata | null;
  from: AccountAddress | null;
  request: TransactionRequest;
  warnings: TransactionWarning[];
  issues: TransactionIssue[];
};

export type TransactionApprovalRequest = ApprovalCreateParams<typeof ApprovalKinds.SendTransaction>;

export type TransactionApprovalHandoff = {
  transactionId: string;
  approvalId: string;
  pendingMeta: TransactionMeta;
  waitForApprovalDecision(): Promise<TransactionMeta>;
};

export type TransactionSubmissionResolution = {
  hash: string;
  meta: TransactionMeta;
};

export type ResumePendingTransactionsOptions = {
  includeSigning?: boolean;
  /**
   * Cold-start retained transactions that should remain visible but must not
   * resume signing/broadcast automatically.
   */
  skipExecutionIds?: readonly string[];
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
  beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
  ): Promise<TransactionApprovalHandoff>;
  waitForTransactionSubmission(id: string): Promise<TransactionSubmissionResolution>;
  approveTransaction(id: string): Promise<TransactionMeta | null>;
  rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void>;
  processTransaction(id: string): Promise<void>;
  resumePending(params?: ResumePendingTransactionsOptions): Promise<void>;
  onStatusChanged(handler: (change: TransactionStatusChange) => void): () => void;
  onStateChanged(handler: (change: TransactionStateChange) => void): () => void;
};

export type {
  Eip155TransactionPayload,
  Eip155TransactionPayloadWithFrom,
  Eip155TransactionRequest,
  TransactionDiagnostic,
  TransactionDiagnosticSeverity,
  TransactionError,
  TransactionIssue,
  TransactionPayload,
  TransactionPrepared,
  TransactionReceipt,
  TransactionRequest,
  TransactionWarning,
} from "../../transactions/types.js";
