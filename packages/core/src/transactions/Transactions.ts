import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { Transaction, TransactionId, TransactionPage, TransactionQuery } from "./types.js";

export type TransactionsChanged = Readonly<{
  type: "transactionsChanged";
  transactionIds: readonly TransactionId[];
}>;

export type Transactions = Readonly<{
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
}>;

export const createTransactions = (params: {
  readers: Pick<CorePersistenceReaders, "transactions">;
}): Transactions => ({
  get: (transactionId) => params.readers.transactions.get(transactionId),
  list: (query) => params.readers.transactions.list(query),
});
