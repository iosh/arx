import type { ChainRef } from "../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../storage/records.js";

export type TransactionsChangedHandler = () => void;

export type CreatePendingTransactionParams = {
  /**
   * Optional caller-provided id to keep controller-level ids stable.
   * Must be a UUID when provided.
   */
  id?: TransactionRecord["id"];
  namespace: TransactionRecord["namespace"];
  chainRef: ChainRef;
  origin: TransactionRecord["origin"];
  fromAccountId: TransactionRecord["fromAccountId"];
  request: TransactionRecord["request"];
  warnings?: TransactionRecord["warnings"];
  issues?: TransactionRecord["issues"];
  /**
   * Optional caller-provided createdAt for deterministic timestamps in tests.
   * When provided, updatedAt is initialized to the same value.
   */
  createdAt?: number;
};

export type TransitionTransactionParams = {
  id: TransactionRecord["id"];
  fromStatus: TransactionStatus;
  toStatus: TransactionStatus;
  patch?: Partial<
    Pick<TransactionRecord, "hash" | "receipt" | "error" | "userRejected" | "warnings" | "issues" | "prepared">
  >;
};

export type PatchTransactionParams = {
  id: TransactionRecord["id"];
  patch: Partial<Pick<TransactionRecord, "prepared" | "warnings" | "issues" | "error">>;
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

  /**
   * Patch a transaction record without changing status.
   * Intended for background enrichment (prepared params, warnings/issues).
   */
  patch(params: PatchTransactionParams): Promise<TransactionRecord | null>;

  remove(id: TransactionRecord["id"]): Promise<void>;

  /**
   * Best-effort cleanup for pending items that can't be recovered after restart.
   * Returns the number of records transitioned to `failed`.
   */
  failAllPending(params?: { reason?: string }): Promise<number>;
};
