import type { ApprovalController } from "../approval/types.js";
import {
  TRANSACTION_APPROVAL_DETAIL_INVALIDATED,
  type TransactionMessenger,
} from "./topics.js";
import type { ApprovalDetailInvalidation, ApprovalDetailInvalidationEvents } from "./types.js";

type Options = {
  messenger: TransactionMessenger;
  approvals: Pick<ApprovalController, "listPendingIdsBySubject">;
};

export class ApprovalDetailInvalidationPublisher implements ApprovalDetailInvalidationEvents {
  #messenger: TransactionMessenger;
  #approvals: Pick<ApprovalController, "listPendingIdsBySubject">;
  #pendingTransactionIds = new Set<string>();
  #pendingApprovalIds = new Set<string>();
  #flushScheduled = false;

  constructor(options: Options) {
    this.#messenger = options.messenger;
    this.#approvals = options.approvals;
  }

  onChanged(handler: (change: ApprovalDetailInvalidation) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_APPROVAL_DETAIL_INVALIDATED, handler);
  }

  enqueue(change: { transactionIds?: string[]; approvalIds?: string[] }): void {
    for (const transactionId of change.transactionIds ?? []) {
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

    if (approvalIds.size === 0) {
      return;
    }

    this.#messenger.publish(TRANSACTION_APPROVAL_DETAIL_INVALIDATED, {
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
