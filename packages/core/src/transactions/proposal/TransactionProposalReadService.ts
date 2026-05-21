import type { TransactionApprovalReviewReader, TransactionProposalReader } from "../runtime.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

type CreateTransactionProposalReaderDeps = {
  proposalRuntime: Pick<TransactionProposalRuntime, "getView" | "getReviewState">;
  review: TransactionApprovalReviewReader;
};

export const createTransactionProposalReader = (
  deps: CreateTransactionProposalReaderDeps,
): TransactionProposalReader => {
  return {
    getProposalView(id: string) {
      const proposal = deps.proposalRuntime.getView(id);
      if (!proposal) {
        return undefined;
      }

      const reviewState = deps.proposalRuntime.getReviewState(id);

      return {
        ...proposal,
        ...(reviewState ? { review: deps.review.getTransactionApprovalReview(id) } : {}),
      };
    },
  };
};
