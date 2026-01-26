import type { ChainRef } from "../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../db/records.js";

export type TransactionsChangedHandler = () => void;

export type CreateTransactionParams = {
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  fromAccountId: string;
  status: TransactionStatus;
  request: TransactionRecord["request"];
  hash: string | null;
  receipt?: unknown;
  error?: unknown;
  userRejected: boolean;
  warnings: TransactionRecord["warnings"];
  issues: TransactionRecord["issues"];
};

export type ListTransactionsParams = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  limit?: number;
};

export type TransactionsService = {
  on(event: "changed", handler: TransactionsChangedHandler): void;
  off(event: "changed", handler: TransactionsChangedHandler): void;

  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;
  list(params?: ListTransactionsParams): Promise<TransactionRecord[]>;

  create(params: CreateTransactionParams): Promise<TransactionRecord>;
  upsert(record: TransactionRecord): Promise<void>;
  remove(id: TransactionRecord["id"]): Promise<void>;
};
