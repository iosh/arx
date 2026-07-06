import type { TransactionReviewDetails } from "../review.js";

export type TransactionReviewError = {
  reason: string;
  message: string;
  data?: unknown | undefined;
};

// User-resolvable review stop: visible review, but approval is not allowed.
export type TransactionReviewBlocker = {
  reason: string;
  message: string;
  data?: unknown | undefined;
};

export type TransactionReviewPrepare =
  | {
      state: "preparing";
    }
  | {
      state: "ready";
    }
  | {
      state: "blocked";
      blocker: TransactionReviewBlocker;
    }
  | {
      state: "failed";
      error: TransactionReviewError;
    };

export type SendTransactionApprovalReview = {
  details: TransactionReviewDetails | null;
  prepare: TransactionReviewPrepare;
};
