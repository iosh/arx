import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { PendingTransactionRecord } from "./persistence.js";

export type TransactionsBootstrap = Readonly<{
  pendingTransactions: readonly PendingTransactionRecord[];
}>;

export const loadTransactionsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "transactions">,
): Promise<TransactionsBootstrap> => ({
  pendingTransactions: await readers.transactions.listPending(),
});
