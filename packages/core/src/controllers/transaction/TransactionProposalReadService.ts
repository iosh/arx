import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionApprovalReviewReader, TransactionProposalReader } from "./types.js";

type CreateTransactionProposalReaderDeps = {
  proposalStore: TransactionProposalStore;
  review: TransactionApprovalReviewReader;
};

export const createTransactionProposalReader = (
  deps: CreateTransactionProposalReaderDeps,
): TransactionProposalReader => {
  return {
    getProposalView(id: string) {
      const proposal = deps.proposalStore.getView(id);
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
