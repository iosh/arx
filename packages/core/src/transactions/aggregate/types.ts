import type { JsonValue } from "./json.js";
import type { TransactionTerminalReason } from "./terminalReason.js";

/** State of the wallet transaction shown in history and recovery. */
export type TransactionStatus =
  | "awaiting_approval"
  | "rejected"
  | "cancelled"
  | "expired"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "failed"
  | "replaced"
  | "dropped";

/** State of one local signing and broadcast attempt. */
export type TransactionSubmissionStatus =
  | "queued"
  | "signing"
  | "signed"
  | "broadcasting"
  | "accepted"
  | "failed"
  | "cancelled"
  | "expired";

export type TransactionSource = "dapp" | "wallet";

/** Local replacement intent for a new transaction. */
export type TransactionReplacementType = "speed_up" | "cancel";

/** Chain-level mutual exclusion key, such as EIP-155 chain/account/nonce. */
export type TransactionConflictKey = {
  kind: string;
  value: string;
};

/** Original dApp request or wallet intent. */
export type TransactionRequestSnapshot = {
  kind: string;
  payload: JsonValue;
};

/** Final payload approved by the user and used for signing. */
export type TransactionApprovedRequest = {
  approvalId: string;
  payload: JsonValue;
  approvedAt: number;
};

/**
 * Main record for one outgoing wallet transaction.
 *
 * History views can read this record alone. Signed payloads stay in submission
 * artifacts.
 */
export type TransactionRecord = {
  id: string;
  namespace: string;
  chainRef: string;
  origin: string;
  source: TransactionSource;
  requestId: string | null;
  accountKey: string;
  status: TransactionStatus;
  request: TransactionRequestSnapshot;
  approvedRequest: TransactionApprovedRequest | null;
  activeSubmissionId: string | null;
  submitted: JsonValue | null;
  receipt: JsonValue | null;
  conflictKey: TransactionConflictKey | null;
  replacesTransactionId: string | null;
  replacementType: TransactionReplacementType | null;
  replacedByTransactionId: string | null;
  terminalReason: TransactionTerminalReason | null;
  createdAt: number;
  updatedAt: number;
};

/** One local attempt to sign and broadcast the approved payload. */
export type TransactionSubmission = {
  id: string;
  transactionId: string;
  status: TransactionSubmissionStatus;
  artifactId: string | null;
  terminalReason: TransactionTerminalReason | null;
  createdAt: number;
  updatedAt: number;
};

export type TransactionSubmissionArtifactRetention = "until_submitted" | "until_final";

/**
 * Sealed signed payload produced by a namespace adapter.
 *
 * Kept outside TransactionRecord so normal history reads do not load
 * broadcastable material.
 */
export type TransactionSubmissionArtifact = {
  id: string;
  transactionId: string;
  submissionId: string;
  namespace: string;
  chainRef: string;
  kind: string;
  sealedPayload: JsonValue;
  retention: TransactionSubmissionArtifactRetention;
  expiresAt: number | null;
  createdAt: number;
};

/** Consistency boundary for one wallet transaction. */
export type TransactionAggregate = {
  record: TransactionRecord;
  submissions: TransactionSubmission[];
  submissionArtifacts: TransactionSubmissionArtifact[];
};

export type TransactionAggregateServiceOptions = {
  now?: () => number;
  createId?: () => string;
};

/** Local replacement intent for a newly created transaction. */
export type CreateTransactionReplacementInput = {
  transactionId: string;
  type: TransactionReplacementType;
};

/** Data captured when a dApp request or wallet intent becomes a transaction. */
export type CreateTransactionInput = {
  namespace: string;
  chainRef: string;
  origin: string;
  source: TransactionSource;
  requestId?: string | null;
  accountKey: string;
  request: TransactionRequestSnapshot;
  replacement?: CreateTransactionReplacementInput | null;
};

/** Approval result that fixes the payload used for signing. */
export type ApproveTransactionInput = {
  transactionId: string;
  approvalId: string;
  approvedRequestPayload: JsonValue;
  /** Null lets the aggregate allocate the first submission id. */
  submissionId: string | null;
  /** Null uses the aggregate clock as the approval time. */
  approvedAt: number | null;
  conflictKey: TransactionConflictKey | null;
};

/** Terminal command for a transaction not yet accepted by the network. */
export type TerminalTransactionInput = {
  transactionId: string;
  /** Null uses the lifecycle default reason for this terminal status. */
  reason: TransactionTerminalReason | null;
};

/** Local failure before network acceptance. */
export type FailTransactionInput = {
  transactionId: string;
  reason: TransactionTerminalReason;
};

type ActiveSubmissionInput = {
  transactionId: string;
  submissionId: string;
};

/** Active submission selected for signing. */
export type BeginSubmissionSigningInput = ActiveSubmissionInput;

/** Signed artifact produced by the active submission. */
export type CompleteSubmissionSigningInput = {
  transactionId: string;
  submissionId: string;
  artifactId?: string;
  artifactKind: string;
  sealedPayload: JsonValue;
  retention?: TransactionSubmissionArtifactRetention;
  expiresAt?: number | null;
};

/** Active signed submission selected for broadcast. */
export type QueueSubmissionBroadcastInput = ActiveSubmissionInput;

/** Provider or network acceptance returned after broadcast. */
export type RecordBroadcastAcceptanceInput = {
  transactionId: string;
  submissionId: string;
  submitted: JsonValue;
};

/** Terminal outcome for the active submission before network acceptance. */
export type TerminalSubmissionInput = ActiveSubmissionInput & {
  reason: TransactionTerminalReason;
};

/** Receipt or confirmation details owned by the namespace adapter. */
export type RecordTransactionReceiptInput = {
  transactionId: string;
  receipt: JsonValue;
};

/** On-chain failure plus the adapter's terminal reason. */
export type RecordTransactionFailedOnChainInput = RecordTransactionReceiptInput & {
  reason: TransactionTerminalReason;
};

/** Replacement by another known local transaction. */
export type RecordTransactionReplacedInput = {
  transactionId: string;
  replacedByTransactionId: string;
  reason: TransactionTerminalReason;
};

/** Tracking no longer expects this transaction to confirm. */
export type RecordTransactionDroppedInput = {
  transactionId: string;
  reason: TransactionTerminalReason;
};

/** Submitted transaction reached a known validity expiry. */
export type RecordTransactionExpiredInput = {
  transactionId: string;
  reason: TransactionTerminalReason;
};
