import type { TransactionProposalReviewState } from "../proposal/types.js";
import type { TransactionReviewDetails } from "../review.js";
import type { SendTransactionApprovalReview } from "./types.js";

export const buildSendTransactionApprovalReview = (args: {
  updatedAt: number;
  review: TransactionProposalReviewState | null;
  details: TransactionReviewDetails | null;
}): SendTransactionApprovalReview => {
  if (args.review?.status === "ready") {
    return {
      updatedAt: args.updatedAt,
      details: args.details,
      prepare: { state: "ready" },
    };
  }

  if (args.review?.status === "blocked" && args.review.blocker) {
    return {
      updatedAt: args.updatedAt,
      details: args.details,
      prepare: { state: "blocked", blocker: args.review.blocker },
    };
  }

  if ((args.review?.status === "failed" || args.review?.status === "invalidated") && args.review.error) {
    return {
      updatedAt: args.updatedAt,
      details: args.details,
      prepare: { state: "failed", error: args.review.error },
    };
  }

  return {
    updatedAt: args.updatedAt,
    details: args.details,
    prepare: { state: "preparing" },
  };
};
