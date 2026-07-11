import type { AccountId } from "../accounts/addressing/accountId.js";
import type { ApprovalSource } from "../approvals/source.js";
import { getChainRefNamespace } from "../chains/caip.js";
import type { ChainRef } from "../chains/ids.js";
import type {
  SubmittedTransactionRecord,
  TransactionConflictKey,
  TransactionFailureReason,
  TransactionJsonObject,
  TransactionRecord,
} from "./persistence.js";
import { TransactionNamespaceAdapterNotFoundError } from "./recordErrors.js";

export type TransactionResourceKey = Readonly<{
  kind: string;
  value: string;
}>;

export type TransactionSubmissionInput = Readonly<{
  chainRef: ChainRef;
  accountId: AccountId;
  origin: string;
  source: ApprovalSource;
  finalizationPayload: TransactionJsonObject;
  replacementTargetId?: string;
}>;

export type TransactionFinalizationResult =
  | Readonly<{
      status: "ready";
      signingPayload: TransactionJsonObject;
      conflictKey?: TransactionConflictKey;
    }>
  | Readonly<{
      status: "rejected";
      reason: TransactionFailureReason;
    }>;

export type TransactionBroadcastOutcome =
  | Readonly<{ status: "submitted"; networkSubmission: TransactionJsonObject }>
  | Readonly<{ status: "rejected"; reason: TransactionFailureReason }>
  | Readonly<{ status: "unknown"; reason: TransactionFailureReason }>;

export type TransactionInspection =
  | Readonly<{ status: "pending"; evidence?: TransactionJsonObject }>
  | Readonly<{ status: "confirmed"; confirmation: TransactionJsonObject }>
  | Readonly<{ status: "failed"; reason: TransactionFailureReason; evidence?: TransactionJsonObject }>
  | Readonly<{ status: "dropped"; evidence?: TransactionJsonObject }>
  | Readonly<{ status: "expired"; evidence?: TransactionJsonObject }>;

export type TransactionNamespaceAdapter = Readonly<{
  namespace: string;
  getResourceKey(input: TransactionSubmissionInput): TransactionResourceKey;
  finalize(input: {
    transactionId: string;
    submission: TransactionSubmissionInput;
    activeTransactions: readonly TransactionRecord[];
  }): Promise<TransactionFinalizationResult>;
  createReplacementPayload(input: {
    target: SubmittedTransactionRecord;
    type: "speed-up" | "cancel";
  }): Promise<TransactionJsonObject>;
  sign(input: {
    accountId: AccountId;
    chainRef: ChainRef;
    signingPayload: TransactionJsonObject;
  }): Promise<TransactionJsonObject>;
  broadcast(input: {
    chainRef: ChainRef;
    signingPayload: TransactionJsonObject;
    signedPayload: TransactionJsonObject;
  }): Promise<TransactionBroadcastOutcome>;
  inspect(record: SubmittedTransactionRecord): Promise<TransactionInspection>;
  getInitialInspectionDelay(record: SubmittedTransactionRecord): number;
  getPendingInspectionDelay(input: { record: SubmittedTransactionRecord; attempt: number }): number;
  getRetryInspectionDelay(input: { record: SubmittedTransactionRecord; attempt: number; error: unknown }): number;
}>;

export type TransactionNamespaceAdapters = ReadonlyMap<string, TransactionNamespaceAdapter>;

export const getTransactionNamespaceAdapter = (
  adapters: TransactionNamespaceAdapters,
  chainRef: ChainRef,
): TransactionNamespaceAdapter => {
  const namespace = getChainRefNamespace(chainRef);
  const adapter = adapters.get(namespace);
  if (!adapter) throw new TransactionNamespaceAdapterNotFoundError(namespace);
  return adapter;
};
