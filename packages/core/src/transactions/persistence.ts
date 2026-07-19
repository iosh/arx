import type { AccountId } from "../accounts/accountId.js";
import type { ApprovalSource } from "../approvals/source.js";
import type { ChainRef } from "../networks/chainRef.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type TransactionId = string;

export type TransactionJsonPrimitive = null | boolean | number | string;
export type TransactionJsonObject = { readonly [key: string]: TransactionJsonValue };
export type TransactionJsonValue = TransactionJsonPrimitive | TransactionJsonObject | readonly TransactionJsonValue[];

export type TransactionConflictKey = Readonly<{
  kind: string;
  value: string;
}>;

export type TransactionFailureReason = Readonly<{
  code: string;
  message: string;
  details?: TransactionJsonObject;
}>;

type TransactionRecordBase = Readonly<{
  transactionId: TransactionId;
  chainRef: ChainRef;
  accountId: AccountId;
  origin: string;
  source: ApprovalSource;
  createAt: number;
  signingPayload: TransactionJsonObject;
  /** Durable key identifying transactions that compete for the same chain resource. */
  conflictKey?: TransactionConflictKey;
}>;

export type SubmittingTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "submitting";
  }>;

export type BroadcastingTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "broadcasting";
  }>;

export type SubmittedTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "submitted";
    networkSubmission: TransactionJsonObject;
  }>;

export type ConfirmedTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "confirmed";
    networkSubmission: TransactionJsonObject;
    confirmation: TransactionJsonObject;
  }>;

export type FailedBeforeSubmissionTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "failed";
    phase: "submitting" | "broadcasting";
    reason: TransactionFailureReason;
  }>;

export type FailedAfterSubmissionTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "failed";
    phase: "submitted";
    networkSubmission: TransactionJsonObject;
    reason: TransactionFailureReason;
    evidence?: TransactionJsonObject;
  }>;

export type ReplacedTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "replaced";
    networkSubmission: TransactionJsonObject;
    replacedByTransactionId: TransactionId;
  }>;

export type DroppedTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "dropped";
    networkSubmission: TransactionJsonObject;
    evidence?: TransactionJsonObject;
  }>;

export type ExpiredTransactionRecord = TransactionRecordBase &
  Readonly<{
    status: "expired";
    networkSubmission: TransactionJsonObject;
    evidence?: TransactionJsonObject;
  }>;

export type TransactionRecord =
  | SubmittingTransactionRecord
  | BroadcastingTransactionRecord
  | SubmittedTransactionRecord
  | ConfirmedTransactionRecord
  | FailedBeforeSubmissionTransactionRecord
  | FailedAfterSubmissionTransactionRecord
  | ReplacedTransactionRecord
  | DroppedTransactionRecord
  | ExpiredTransactionRecord;

export type TransactionStatus = TransactionRecord["status"];

export type TransactionHistoryCursor = Readonly<{
  createAt: number;
  transactionId: TransactionId;
}>;

export type TransactionHistoryQuery = Readonly<{
  accountId?: AccountId;
  chainRef?: ChainRef;
  statuses?: readonly TransactionStatus[];
  cursor?: TransactionHistoryCursor;
  limit: number;
}>;

export type TransactionHistoryPage = Readonly<{
  transactions: readonly TransactionRecord[];
  nextCursor?: TransactionHistoryCursor;
}>;

export interface TransactionsReader {
  get(transactionId: TransactionId): Promise<TransactionRecord | null>;
  listHistory(query: TransactionHistoryQuery): Promise<TransactionHistoryPage>;
  listByConflictKey(query: { chainRef: ChainRef; conflictKey: TransactionConflictKey }): Promise<TransactionRecord[]>;
  listByStatuses(statuses: readonly TransactionStatus[]): Promise<TransactionRecord[]>;
  existsByChainRefAndStatuses(query: { chainRef: ChainRef; statuses: readonly TransactionStatus[] }): Promise<boolean>;
  listIds(): Promise<TransactionId[]>;
}

export const transactionPersistenceType: KeyedPersistenceType<"transaction", TransactionRecord, TransactionId> =
  defineKeyedPersistenceType<"transaction", TransactionRecord, TransactionId>("transaction");
