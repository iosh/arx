import type { NamespaceTransactionReview } from "../../../transactions/review.js";
import type { SendTransactionApprovalReview, TransactionProposalReviewState } from "./types.js";

export const buildSendTransactionApprovalReview = (args: {
  updatedAt: number;
  review: TransactionProposalReviewState | null;
  namespaceReview: NamespaceTransactionReview | null;
}): SendTransactionApprovalReview => {
  if (args.review?.status === "ready") {
    return {
      updatedAt: args.updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "ready" },
    };
  }

  if (args.review?.status === "blocked" && args.review.blocker) {
    return {
      updatedAt: args.updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "blocked", blocker: args.review.blocker },
    };
  }

  if ((args.review?.status === "failed" || args.review?.status === "invalidated") && args.review.error) {
    return {
      updatedAt: args.updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "failed", error: args.review.error },
    };
  }

  return {
    updatedAt: args.updatedAt,
    namespaceReview: args.namespaceReview,
    prepare: { state: "preparing" },
  };
};
