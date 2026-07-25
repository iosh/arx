import type { PendingTransactionRecord, TransactionsReader } from "./persistence.js";

export type TransactionsBootstrap = Readonly<{
  pendingTransactions: readonly PendingTransactionRecord[];
}>;

export const loadTransactionsBootstrap = async (
  readers: Readonly<{ transactions: Pick<TransactionsReader, "listPending"> }>,
): Promise<TransactionsBootstrap> => ({
  pendingTransactions: await readers.transactions.listPending(),
});
