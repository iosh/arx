import type { ApprovalController } from "../approval/types.js";
import { TRANSACTION_STATE_CHANGED, type TransactionMessenger } from "./topics.js";
import type { TransactionStateChange, TransactionStateChangeEvents } from "./types.js";

type TransactionStateChangePublisherOptions = {
  messenger: TransactionMessenger;
  approvals: Pick<ApprovalController, "listPendingIdsBySubject">;
};

export class TransactionStateChangePublisher implements TransactionStateChangeEvents {
  #messenger: TransactionMessenger;
  #approvals: Pick<ApprovalController, "listPendingIdsBySubject">;
  #pendingTransactionIds = new Set<string>();
  #pendingApprovalIds = new Set<string>();
  #flushScheduled = false;

  constructor(options: TransactionStateChangePublisherOptions) {
    this.#messenger = options.messenger;
    this.#approvals = options.approvals;
  }

  onStateChanged(handler: (change: TransactionStateChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_CHANGED, handler);
  }

  enqueue(change: { transactionIds: string[]; approvalIds?: string[] }): void {
    for (const transactionId of change.transactionIds) {
      this.#pendingTransactionIds.add(transactionId);
    }
    for (const approvalId of change.approvalIds ?? []) {
      this.#pendingApprovalIds.add(approvalId);
    }

    if (this.#flushScheduled) {
      return;
    }

    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      this.#publishPendingChange();
    });
  }

  #publishPendingChange(): void {
    const transactionIds = [...this.#pendingTransactionIds];
    const approvalIds = new Set<string>(this.#pendingApprovalIds);
    this.#pendingTransactionIds.clear();
    this.#pendingApprovalIds.clear();

    for (const transactionId of transactionIds) {
      for (const approvalId of this.#listPendingApprovalIdsForTransaction(transactionId)) {
        approvalIds.add(approvalId);
      }
    }

    this.#messenger.publish(TRANSACTION_STATE_CHANGED, {
      transactionIds,
      approvalIds: [...approvalIds],
    });
  }

  #listPendingApprovalIdsForTransaction(transactionId: string): string[] {
    return this.#approvals.listPendingIdsBySubject({
      kind: "transaction",
      transactionId,
    });
  }
}
