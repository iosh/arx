import type { TransactionMeta } from "../types.js";
import type { SendTransactionApprovalReview, TransactionReviewSession, TransactionReviewState } from "./types.js";

const deriveReviewState = (
  meta: TransactionMeta | undefined,
  session?: TransactionReviewSession | undefined,
): TransactionReviewState => {
  if (!session) {
    if (!meta) {
      return {
        status: "preparing",
        updatedAt: 0,
      };
    }

    if (!meta.prepared) {
      return {
        status: "preparing",
        updatedAt: meta.updatedAt,
      };
    }

    return {
      status: "ready",
      updatedAt: meta.updatedAt,
    };
  }

  return {
    status: session.status === "invalidated" ? "failed" : session.status,
    updatedAt: session.updatedAt,
  };
};

export const projectTransactionReviewState = (
  transaction: TransactionMeta | undefined,
  session?: TransactionReviewSession | undefined,
) => {
  const reviewState = deriveReviewState(transaction, session);
  const prepareFailure = session?.prepareFailure ?? null;
  const approvalBlocker = reviewState.status === "ready" ? (session?.approvalBlocker ?? null) : null;
  const reviewNotices = session?.reviewNotices ?? [];

  return {
    reviewState,
    prepareFailure,
    approvalBlocker,
    reviewNotices,
  } satisfies Pick<
    SendTransactionApprovalReview,
    "reviewState" | "prepareFailure" | "approvalBlocker" | "reviewNotices"
  >;
};

export const buildSendTransactionApprovalReview = (args: {
  transaction: TransactionMeta | undefined;
  session?: TransactionReviewSession | undefined;
  namespaceReview: SendTransactionApprovalReview["namespaceReview"];
}): SendTransactionApprovalReview => {
  return {
    ...projectTransactionReviewState(args.transaction, args.session),
    namespaceReview: args.namespaceReview,
  };
};
