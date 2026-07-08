import { OWNER_CHANGED } from "../events/ownerChanged.js";
import type { Messenger } from "../messenger/index.js";

export type TransactionsChangedHandler = (transactionIds: readonly string[]) => void;
type TransactionRecordsCommittedHandler = (transactionIds: readonly string[]) => void | Promise<void>;

const emitTransactionChanged = (handlers: Set<TransactionsChangedHandler>, transactionIds: readonly string[]): void => {
  for (const handler of handlers) {
    handler(transactionIds);
  }
};

const runTransactionRecordsCommittedHandlers = async (
  handlers: Set<TransactionRecordsCommittedHandler>,
  transactionIds: readonly string[],
): Promise<void> => {
  for (const handler of handlers) {
    await handler(transactionIds);
  }
};

export class TransactionChangePublisher {
  #messenger: Messenger | null;
  #transactionChangedHandlers = new Set<TransactionsChangedHandler>();
  #transactionRecordsCommittedHandlers = new Set<TransactionRecordsCommittedHandler>();

  constructor(messenger?: Messenger) {
    this.#messenger = messenger ?? null;
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    this.#transactionChangedHandlers.add(handler);
    return () => {
      this.#transactionChangedHandlers.delete(handler);
    };
  }

  onTransactionRecordsCommitted(handler: TransactionRecordsCommittedHandler): () => void {
    this.#transactionRecordsCommittedHandlers.add(handler);
    return () => {
      this.#transactionRecordsCommittedHandlers.delete(handler);
    };
  }

  async publishTransactionsChanged(transactionIds: readonly string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(transactionIds));
    if (uniqueIds.length === 0) {
      return;
    }

    await runTransactionRecordsCommittedHandlers(this.#transactionRecordsCommittedHandlers, uniqueIds);
    emitTransactionChanged(this.#transactionChangedHandlers, uniqueIds);
    this.#messenger?.publish(OWNER_CHANGED, {
      topic: "transactions",
      change: "records",
      transactionIds: uniqueIds,
    });
  }
}
