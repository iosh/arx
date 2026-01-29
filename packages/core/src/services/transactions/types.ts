import type { ChainRef } from "../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../db/records.js";

export type TransactionsChangedHandler = () => void;

export type CreatePendingTransactionParams = {
  namespace: TransactionRecord["namespace"];
  chainRef: ChainRef;
  origin: TransactionRecord["origin"];
  fromAccountId: TransactionRecord["fromAccountId"];
  request: TransactionRecord["request"];
  warnings?: TransactionRecord["warnings"];
  issues?: TransactionRecord["issues"];
};

export type TransitionTransactionParams = {
  id: TransactionRecord["id"];
  fromStatus: TransactionStatus;
  toStatus: TransactionStatus;
  patch?: Partial<Pick<TransactionRecord, "hash" | "receipt" | "error" | "userRejected" | "warnings" | "issues">>;
};

export type ListTransactionsParams = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  limit?: number;
  beforeCreatedAt?: number;
};

export type TransactionsService = {
  on(event: "changed", handler: TransactionsChangedHandler): void;
  off(event: "changed", handler: TransactionsChangedHandler): void;

  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;
  list(params?: ListTransactionsParams): Promise<TransactionRecord[]>;

  createPending(params: CreatePendingTransactionParams): Promise<TransactionRecord>;

  transition(params: TransitionTransactionParams): Promise<TransactionRecord | null>;

  remove(id: TransactionRecord["id"]): Promise<void>;
};
