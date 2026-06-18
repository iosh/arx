import type { TransactionAggregate, TransactionConflictKey, TransactionRecord, TransactionStatus } from "./types.js";

export type ListTransactionHistoryCursor = {
  createdAt: number;
  id: string;
};

export type ListTransactionHistoryQuery = {
  namespace?: string;
  chainRef?: string;
  accountKey?: string;
  status?: TransactionStatus;
  limit?: number;
  before?: ListTransactionHistoryCursor;
};

export type ListRecoverableTransactionAggregatesQuery = {
  limit?: number;
};

export type InsertApprovedTransactionAggregateInput = {
  aggregate: TransactionAggregate;
};

export interface TransactionsStoragePort {
  loadTransactionAggregate(transactionId: TransactionRecord["id"]): Promise<TransactionAggregate | null>;

  insertTransactionAggregate(aggregate: TransactionAggregate): Promise<void>;

  saveTransactionAggregate(aggregate: TransactionAggregate): Promise<void>;

  insertApprovedTransactionAggregate(input: InsertApprovedTransactionAggregateInput): Promise<void>;

  listTransactionHistory(query?: ListTransactionHistoryQuery): Promise<TransactionRecord[]>;

  findTransactionRecordsByConflictKey(key: TransactionConflictKey): Promise<TransactionRecord[]>;

  listRecoverableTransactionAggregates(
    query?: ListRecoverableTransactionAggregatesQuery,
  ): Promise<TransactionAggregate[]>;
}
