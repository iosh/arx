import type { TransactionApprovalReviewReader, TransactionProposalReader } from "../runtime.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

type CreateTransactionProposalReaderDeps = {
  proposalRuntime: Pick<TransactionProposalRuntime, "getProposalSnapshot" | "getReviewState">;
  review: TransactionApprovalReviewReader;
};

export const createTransactionProposalReader = (
  deps: CreateTransactionProposalReaderDeps,
): TransactionProposalReader => {
  return {
    getProposalReviewView(id: string) {
      const proposal = deps.proposalRuntime.getProposalSnapshot(id);
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
