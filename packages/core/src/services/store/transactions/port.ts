import type { ChainRef } from "../../../chains/ids.js";
import type { TransactionRecord, TransactionStatus } from "../../../storage/records.js";

export type ListTransactionsQuery = {
  chainRef?: ChainRef;
  status?: TransactionStatus;
  limit?: number;
  beforeCreatedAt?: number;
};
export interface TransactionsPort {
  get(id: TransactionRecord["id"]): Promise<TransactionRecord | null>;

  list(query?: ListTransactionsQuery): Promise<TransactionRecord[]>;

  findByChainRefAndHash(params: { chainRef: ChainRef; hash: string }): Promise<TransactionRecord | null>;

  upsert(record: TransactionRecord): Promise<void>;

  updateIfStatus(params: {
    id: TransactionRecord["id"];
    expectedStatus: TransactionStatus;
    next: TransactionRecord;
  }): Promise<boolean>;

  remove(id: TransactionRecord["id"]): Promise<void>;
}
