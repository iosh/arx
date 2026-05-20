import type { ChainRef } from "../../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../../storage/records.js";
import type { ListTransactionsCursor } from "./types.js";

export type ListTransactionsQuery = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  replacementKey?: TransactionRecord["replacementKey"];
  limit?: number;
  before?: ListTransactionsCursor;
};
export interface TransactionsPort {
  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;

  list(query?: ListTransactionsQuery): Promise<TransactionRecord[]>;

  findByReplacementKey(key: NonNullable<TransactionRecord["replacementKey"]>): Promise<TransactionRecord[]>;

  // Inserts a new transaction row. Duplicate ids must fail instead of overwriting.
  create(record: TransactionRecord): Promise<void>;

  // Compares the current persisted status before replacing the full row.
  updateIfStatus(params: {
    id: TransactionRecord["id"];
    expectedStatus: TransactionStatus;
    next: TransactionRecord;
  }): Promise<boolean>;

  remove(id: TransactionRecord["id"]): Promise<void>;
}
