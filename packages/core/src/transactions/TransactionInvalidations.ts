type InvalidationHandler<T extends string> = (ids: readonly T[]) => void;

export type TransactionsChangedHandler = InvalidationHandler<string>;

export type TransactionApprovalsChangedHandler = InvalidationHandler<string>;

const emitInvalidation = <T extends string>(handlers: Set<InvalidationHandler<T>>, ids: readonly T[]): void => {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return;
  }

  for (const handler of handlers) {
    try {
      handler(uniqueIds);
    } catch {
      // Invalidation listeners refresh read models; they must not roll back a completed transaction write.
    }
  }
};

/** Shared transaction invalidation subscriptions. */
export class TransactionInvalidations {
  #transactionChangedHandlers = new Set<TransactionsChangedHandler>();
  #approvalChangedHandlers = new Set<TransactionApprovalsChangedHandler>();

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    this.#transactionChangedHandlers.add(handler);
    return () => {
      this.#transactionChangedHandlers.delete(handler);
    };
  }

  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void {
    this.#approvalChangedHandlers.add(handler);
    return () => {
      this.#approvalChangedHandlers.delete(handler);
    };
  }

  publishTransactionsChanged(transactionIds: readonly string[]): void {
    emitInvalidation(this.#transactionChangedHandlers, transactionIds);
  }

  publishTransactionApprovalsChanged(approvalIds: readonly string[]): void {
    emitInvalidation(this.#approvalChangedHandlers, approvalIds);
  }
}
