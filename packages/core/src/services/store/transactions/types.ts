import type { ChainRef } from "../../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type TransactionsChangedPayload =
  | { kind: "createSubmitted"; id: TransactionRecord["id"] }
  | { kind: "transition"; id: TransactionRecord["id"]; fromStatus: TransactionStatus; toStatus: TransactionStatus }
  | {
      kind: "patch";
      id: TransactionRecord["id"];
      status: TransactionStatus;
      keys: Array<keyof Pick<TransactionRecord, "locator" | "receipt" | "replacedId">>;
    }
  | { kind: "remove"; id: TransactionRecord["id"] };

export type CreateSubmittedTransactionParams = {
  /**
   * Optional caller-provided id to keep controller-level ids stable.
   * Must be a UUID when provided.
   */
  id?: TransactionRecord["id"];
  chainRef: ChainRef;
  origin: TransactionRecord["origin"];
  fromAccountKey: TransactionRecord["fromAccountKey"];
  submitted: TransactionRecord["submitted"];
  locator: TransactionRecord["locator"];
  status: TransactionRecord["status"];
  receipt?: TransactionRecord["receipt"] | undefined;
  replacedId?: TransactionRecord["replacedId"] | undefined;
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
  patch?: Partial<Pick<TransactionRecord, "locator" | "receipt" | "replacedId">>;
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

export type PatchTransactionParams = {
  id: TransactionRecord["id"];
  expectedStatus: TransactionStatus;
  patch: Partial<Pick<TransactionRecord, "locator" | "receipt" | "replacedId">>;
};

export type TransactionsService = {
  subscribeChanged(handler: (payload: TransactionsChangedPayload) => void): Unsubscribe;

  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;
  list(params?: ListTransactionsParams): Promise<TransactionRecord[]>;

  createSubmitted(params: CreateSubmittedTransactionParams): Promise<TransactionRecord>;

  transition(params: TransitionTransactionParams): Promise<TransactionRecord | null>;

  patchIfStatus(params: PatchTransactionParams): Promise<TransactionRecord | null>;

  remove(id: TransactionRecord["id"]): Promise<void>;
};
