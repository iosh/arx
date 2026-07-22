import type { Hex } from "ox/Hex";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type * as Eip155 from "./eip155/types.js";
import type { Transaction, TransactionId, TransactionPage, TransactionQuery } from "./types.js";

export type {
  Transaction,
  TransactionCursor,
  TransactionId,
  TransactionPage,
  TransactionQuery,
  TransactionStatus,
} from "./types.js";

export type Eip155PendingTransactionRecord = Omit<Eip155.Transaction, "state"> &
  Readonly<{
    state: Readonly<{ status: "pending" }>;
    recovery: Readonly<{ rawTransaction: Hex }>;
  }>;

type Eip155TerminalTransactionRecord = Omit<Eip155.Transaction, "state"> &
  Readonly<{
    state: Exclude<Eip155.TransactionState, Readonly<{ status: "pending" }>>;
    recovery?: never;
  }>;

export type TransactionRecord = Eip155PendingTransactionRecord | Eip155TerminalTransactionRecord;

export type PendingTransactionRecord = Eip155PendingTransactionRecord;

export const isPendingTransactionRecord = (record: TransactionRecord): record is PendingTransactionRecord =>
  record.state.status === "pending";

export const transactionRecordToTransaction = (record: TransactionRecord): Transaction => ({
  transactionId: record.transactionId,
  namespace: record.namespace,
  chainRef: record.chainRef,
  accountId: record.accountId,
  initiator: record.initiator,
  networkTransactionId: record.networkTransactionId,
  ...(record.replacesTransactionId === undefined ? {} : { replacesTransactionId: record.replacesTransactionId }),
  transaction: record.transaction,
  state: record.state,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export interface TransactionsReader {
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
  listPending(): Promise<readonly PendingTransactionRecord[]>;
}

export const transactionPersistenceType: KeyedPersistenceType<"transaction", TransactionRecord, TransactionId> =
  defineKeyedPersistenceType<"transaction", TransactionRecord, TransactionId>("transaction");
