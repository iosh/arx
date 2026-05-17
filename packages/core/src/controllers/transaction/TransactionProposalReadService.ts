import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import type { TransactionApprovalReviewReader, TransactionProposalReader } from "./types.js";

type CreateTransactionProposalReaderDeps = {
  proposalRuntime: TransactionProposalRuntime;
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

      return {
        ...proposal,
        review: deps.review.getTransactionApprovalReview(id),
      };
    },
  };
};
