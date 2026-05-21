import type { TransactionApprovalResult } from "../runtime.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

type TransactionProposalApprovalServiceDeps = {
  proposalRuntime: Pick<TransactionProposalRuntime, "getProposalSnapshot" | "approvePendingProposal">;
  now: () => number;
};

export class TransactionProposalApprovalService {
  #proposalRuntime: Pick<TransactionProposalRuntime, "getProposalSnapshot" | "approvePendingProposal">;
  #now: () => number;

  constructor(deps: TransactionProposalApprovalServiceDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
    this.#now = deps.now;
  }

  approvePendingProposal(id: string): TransactionApprovalResult {
    const updatedAt = this.#now();
    const existing = this.#proposalRuntime.getProposalSnapshot(id) ?? null;
    const approved = this.#proposalRuntime.approvePendingProposal({ id, updatedAt });
    switch (approved.status) {
      case "approved":
        return { status: "approved", transactionId: id };
      case "not_found":
        return {
          status: "failed",
          reason: "not_found",
          message: "Transaction not found.",
          data: { transactionId: id },
        };
      case "not_pending":
        return {
          status: "failed",
          reason: "not_pending",
          transaction: existing ?? undefined,
          message: "Transaction is no longer pending approval.",
          data: { transactionId: id, status: approved.statusValue },
        };
      case "prepare_not_ready":
        return {
          status: "failed",
          reason: "prepare_not_ready",
          transaction: existing ?? undefined,
          message: "Transaction preparation is not ready yet.",
          data: { transactionId: id, prepareState: approved.prepareState },
        };
      case "prepare_blocked":
        return {
          status: "failed",
          reason: "prepare_blocked",
          transaction: existing ?? undefined,
          message: approved.blocker.message,
          data: {
            transactionId: id,
            blocker: approved.blocker,
          },
        };
      case "prepare_failed":
        return {
          status: "failed",
          reason: "prepare_failed",
          transaction: existing ?? undefined,
          message: approved.error.message,
          data: {
            transactionId: id,
            error: approved.error,
            prepareState: approved.prepareState,
          },
        };
    }
  }
}
