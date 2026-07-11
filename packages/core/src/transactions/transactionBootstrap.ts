import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { TransactionRecord } from "./persistence.js";

export type TransactionsBootstrap = Readonly<{
  activeTransactions: readonly TransactionRecord[];
}>;

export const loadTransactionsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "transactions">,
): Promise<TransactionsBootstrap> => ({
  activeTransactions: await readers.transactions.listByStatuses(["submitting", "broadcasting", "submitted"]),
});
