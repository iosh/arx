import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionApprovalResult } from "./types.js";

type TransactionProposalApprovalServiceDeps = {
  proposalStore: Pick<
    TransactionProposalStore,
    | "getView"
    | "getPreparedForExecution"
    | "peek"
    | "approvePendingProposal"
    | "getReviewState"
    | "matchesDraftRevision"
  >;
  now: () => number;
};

export class TransactionProposalApprovalService {
  #proposalStore: Pick<
    TransactionProposalStore,
    | "getView"
    | "getPreparedForExecution"
    | "peek"
    | "approvePendingProposal"
    | "getReviewState"
    | "matchesDraftRevision"
  >;
  #now: () => number;

  constructor(deps: TransactionProposalApprovalServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#now = deps.now;
  }

  approvePendingProposal(id: string): TransactionApprovalResult {
    const updatedAt = this.#now();
    const existing = this.#proposalStore.getView(id) ?? null;
    if (!existing) {
      return {
        status: "failed",
        reason: "not_found",
        message: "Transaction not found.",
        data: { transactionId: id },
      };
    }

    const current = this.#proposalStore.peek(id);
    if (!current || current.phase !== "pending") {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id, phase: current?.phase ?? existing.phase },
      };
    }

    const review = this.#proposalStore.getReviewState(id);
    if (!review) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id, prepareState: "missing_prepare" },
      };
    }

    if (!this.#proposalStore.matchesDraftRevision(id, current.draftRevision)) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id, prepareState: "stale_review" },
      };
    }

    if (review.status === "preparing") {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: id, prepareState: review.status },
      };
    }

    if (review.status === "blocked") {
      return {
        status: "failed",
        reason: "prepare_blocked",
        transaction: existing,
        message: review.blocker?.message ?? "Transaction is blocked.",
        data: {
          transactionId: id,
          ...(review.blocker ? { blocker: review.blocker } : {}),
        },
      };
    }

    if (review.status === "failed" || review.status === "invalidated") {
      return {
        status: "failed",
        reason: "prepare_failed",
        transaction: existing,
        message: review.error?.message ?? "Transaction preparation failed.",
        data: {
          transactionId: id,
          ...(review.error ? { error: review.error } : {}),
        },
      };
    }

    const prepared = this.#proposalStore.getPreparedForExecution(id);
    if (!prepared) {
      throw new Error(`Transaction ${id} reached ready prepare state without execution prepared params.`);
    }

    const approved = this.#proposalStore.approvePendingProposal({ id, updatedAt });
    if (!approved) {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: this.#proposalStore.getView(id) ?? existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: id },
      };
    }

    return { status: "approved", transactionId: id };
  }
}
