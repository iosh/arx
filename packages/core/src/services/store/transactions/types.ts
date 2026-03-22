import type { ChainRef } from "../../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../../storage/records.js";
import type { TransactionRequest } from "../../../transactions/types.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type TransactionsChangedPayload =
  | { kind: "createPending"; id: TransactionRecord["id"] }
  | { kind: "patch"; id: TransactionRecord["id"] }
  | { kind: "transition"; id: TransactionRecord["id"]; fromStatus: TransactionStatus; toStatus: TransactionStatus }
  | { kind: "remove"; id: TransactionRecord["id"] };

export type CreatePendingTransactionParams = {
  /**
   * Optional caller-provided id to keep controller-level ids stable.
   * Must be a UUID when provided.
   */
  id?: TransactionRecord["id"];
  namespace: TransactionRecord["namespace"];
  chainRef: ChainRef;
  origin: TransactionRecord["origin"];
  fromAccountKey: TransactionRecord["fromAccountKey"];
  request: TransactionRequest;
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

export type ListTransactionsCursor = {
  createdAt: number;
  id: TransactionRecord["id"];
};

export type ListTransactionsParams = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  limit?: number;
  before?: ListTransactionsCursor;
};

export type TransactionsService = {
  subscribeChanged(handler: (payload: TransactionsChangedPayload) => void): Unsubscribe;

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
