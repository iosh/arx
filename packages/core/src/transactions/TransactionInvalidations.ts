import { OWNER_CHANGED } from "../events/ownerChanged.js";
import type { Messenger } from "../messenger/index.js";

type InvalidationHandler<T extends string> = (ids: readonly T[]) => void;

export type TransactionsChangedHandler = InvalidationHandler<string>;

const emitInvalidation = <T extends string>(handlers: Set<InvalidationHandler<T>>, ids: readonly T[]): T[] => {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return [];
  }

  for (const handler of handlers) {
    try {
      handler(uniqueIds);
    } catch {
      // Invalidation listeners refresh read models; they must not roll back a completed transaction write.
    }
  }

  return uniqueIds;
};

/** Shared transaction invalidation subscriptions. */
export class TransactionInvalidations {
  #messenger: Messenger | null;
  #transactionChangedHandlers = new Set<TransactionsChangedHandler>();

  constructor(messenger?: Messenger) {
    this.#messenger = messenger ?? null;
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    this.#transactionChangedHandlers.add(handler);
    return () => {
      this.#transactionChangedHandlers.delete(handler);
    };
  }

  publishTransactionsChanged(transactionIds: readonly string[]): void {
    const uniqueIds = emitInvalidation(this.#transactionChangedHandlers, transactionIds);
    if (uniqueIds.length > 0) {
      this.#messenger?.publish(OWNER_CHANGED, {
        topic: "transactions",
        change: "records",
        transactionIds: uniqueIds,
      });
    }
  }
}
