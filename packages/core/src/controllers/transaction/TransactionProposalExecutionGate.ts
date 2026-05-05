import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import type { TransactionApprovalResult, TransactionProposalExecutionGate } from "./types.js";

type CreateTransactionProposalExecutionGateDeps = {
  proposalStore: TransactionProposalStore;
  reviewSessions: TransactionReviewSessionStore;
  readTransactionTimestamp: () => number;
};

export const createTransactionProposalExecutionGate = (
  deps: CreateTransactionProposalExecutionGateDeps,
): TransactionProposalExecutionGate => {
  return {
    approveForExecution(id: string): TransactionApprovalResult {
      const existing = deps.proposalStore.getView(id) ?? null;
      if (!existing) {
        return {
          status: "failed",
          reason: "not_found",
          message: "Transaction not found.",
          data: { transactionId: id },
        };
      }

      const proposal = deps.proposalStore.peek(id);
      if (!proposal || proposal.phase !== "pending") {
        return {
          status: "failed",
          reason: "not_pending",
          transaction: existing,
          message: "Transaction is no longer pending approval.",
          data: { transactionId: id, phase: proposal?.phase ?? existing.phase },
        };
      }

      const reviewState = deps.reviewSessions.get(id);
      if (!reviewState) {
        return {
          status: "failed",
          reason: "prepare_not_ready",
          transaction: existing,
          message: "Transaction preparation is not ready yet.",
          data: { transactionId: id, prepareState: "missing_review_session" },
        };
      }

      if (reviewState.status === "blocked") {
        return {
          status: "failed",
          reason: "prepare_blocked",
          transaction: existing,
          message: reviewState.blocker?.message ?? "Transaction is blocked.",
          data: {
            transactionId: id,
            ...(reviewState.blocker ? { blocker: reviewState.blocker } : {}),
          },
        };
      }

      if (reviewState.status === "failed" || reviewState.status === "invalidated") {
        return {
          status: "failed",
          reason: "prepare_failed",
          transaction: existing,
          message: reviewState.error?.message ?? "Transaction preparation failed.",
          data: {
            transactionId: id,
            ...(reviewState.error ? { error: reviewState.error } : {}),
          },
        };
      }

      if (reviewState.status !== "ready") {
        return {
          status: "failed",
          reason: "prepare_not_ready",
          transaction: existing,
          message: "Transaction preparation is not ready yet.",
          data: { transactionId: id, prepareState: reviewState.status },
        };
      }

      if (!deps.proposalStore.hasCurrentPrepared(id)) {
        return {
          status: "failed",
          reason: "prepare_not_ready",
          transaction: existing,
          message: "Transaction preparation is not ready yet.",
          data: { transactionId: id },
        };
      }

      const updated = deps.proposalStore.approvePendingProposal({
        id,
        updatedAt: deps.readTransactionTimestamp(),
      });
      if (!updated) {
        return {
          status: "failed",
          reason: "not_pending",
          transaction: deps.proposalStore.getView(id) ?? undefined,
          message: "Transaction is no longer pending approval.",
          data: { transactionId: id },
        };
      }

      return { status: "approved", transactionId: id };
    },
  };
};
