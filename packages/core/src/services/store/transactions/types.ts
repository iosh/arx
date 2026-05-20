import type { ChainRef } from "../../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type TransactionsChangedPayload =
  | { kind: "recordCreated"; id: TransactionRecord["id"]; status: TransactionStatus }
  | {
      kind: "recordStatusUpdated";
      id: TransactionRecord["id"];
      fromStatus: TransactionStatus;
      toStatus: TransactionStatus;
    }
  | {
      kind: "recordLinked";
      id: TransactionRecord["id"];
      status: TransactionStatus;
      keys: Array<keyof Pick<TransactionRecord, "receipt" | "replacedByRecordId" | "replacementKey">>;
    }
  | { kind: "remove"; id: TransactionRecord["id"] };

export class TransactionRecordConflictError extends Error {
  readonly conflict: { kind: "id"; id: TransactionRecord["id"] };

  constructor(conflict: { kind: "id"; id: TransactionRecord["id"] }) {
    const message = `Conflicting submitted transaction id "${conflict.id}"`;
    super(message);
    this.name = "TransactionRecordConflictError";
    this.conflict = conflict;
  }
}

export type CreateBroadcastRecordParams = {
  /**
   * Optional caller-provided id to keep controller-level ids stable.
   * Must be a UUID when provided.
   */
  id?: TransactionRecord["id"];
  chainRef: ChainRef;
  origin: TransactionRecord["origin"];
  accountKey: TransactionRecord["accountKey"];
  submitted: TransactionRecord["submitted"];
  receipt?: TransactionRecord["receipt"] | undefined;
  replacedByRecordId?: TransactionRecord["replacedByRecordId"] | undefined;
  replacementKey?: TransactionRecord["replacementKey"] | undefined;
  /**
   * Optional caller-provided createdAt for deterministic timestamps in tests.
   * When provided, updatedAt is initialized to the same value.
   */
  createdAt?: number;
};

export type UpdateRecordStatusParams = {
  id: TransactionRecord["id"];
  fromStatus: TransactionStatus;
  toStatus: TransactionStatus;
  patch?: Partial<Pick<TransactionRecord, "receipt" | "replacedByRecordId" | "replacementKey">>;
};

export type ListTransactionsCursor = {
  createdAt: number;
  id: TransactionRecord["id"];
};

export type ListTransactionsParams = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  replacementKey?: TransactionRecord["replacementKey"];
  limit?: number;
  before?: ListTransactionsCursor;
};

export type LinkRecordParams = {
  id: TransactionRecord["id"];
  expectedStatus: TransactionStatus;
  patch: Partial<Pick<TransactionRecord, "receipt" | "replacedByRecordId" | "replacementKey">>;
};

export type TransactionsService = {
  subscribeChanged(handler: (payload: TransactionsChangedPayload) => void): Unsubscribe;

  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;
  list(params?: ListTransactionsParams): Promise<TransactionRecord[]>;
  findByReplacementKey(key: NonNullable<TransactionRecord["replacementKey"]>): Promise<TransactionRecord[]>;

  createBroadcastRecord(params: CreateBroadcastRecordParams): Promise<TransactionRecord>;

  updateRecordStatus(params: UpdateRecordStatusParams): Promise<TransactionRecord | null>;

  linkRecord(params: LinkRecordParams): Promise<TransactionRecord | null>;

  remove(id: TransactionRecord["id"]): Promise<void>;
};
