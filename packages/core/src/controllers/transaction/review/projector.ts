import type { TransactionMeta } from "../types.js";
import type { NamespaceTransactionReview, SendTransactionApprovalReview, TransactionReviewSession } from "./types.js";

const deriveUpdatedAt = (transaction: TransactionMeta | undefined, session?: TransactionReviewSession): number => {
  return session?.updatedAt ?? transaction?.updatedAt ?? 0;
};

export const buildSendTransactionApprovalReview = (args: {
  transaction: TransactionMeta | undefined;
  session?: TransactionReviewSession | undefined;
  namespaceReview: NamespaceTransactionReview | null;
}): SendTransactionApprovalReview => {
  const updatedAt = deriveUpdatedAt(args.transaction, args.session);

  if (!args.session) {
    if (args.transaction?.prepared) {
      return {
        updatedAt,
        namespaceReview: args.namespaceReview,
        prepare: { state: "ready" },
      };
    }

    return {
      updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "preparing" },
    };
  }

  if (args.session.status === "ready") {
    return {
      updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "ready" },
    };
  }

  if (args.session.status === "blocked" && args.session.blocker) {
    return {
      updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "blocked", blocker: args.session.blocker },
    };
  }

  if ((args.session.status === "failed" || args.session.status === "invalidated") && args.session.error) {
    return {
      updatedAt,
      namespaceReview: args.namespaceReview,
      prepare: { state: "failed", error: args.session.error },
    };
  }

  return {
    updatedAt,
    namespaceReview: args.namespaceReview,
    prepare: { state: "preparing" },
  };
};
