import type { TransactionMeta } from "../types.js";
import type {
  SendTransactionApprovalReview,
  TransactionReviewError,
  TransactionReviewMessage,
  TransactionReviewSession,
  TransactionReviewState,
} from "./types.js";

const toReviewMessage = (
  value:
    | {
        code: string;
        message: string;
        data?: unknown;
      }
    | undefined,
): TransactionReviewMessage | null => {
  if (!value) {
    return null;
  }

  return {
    code: value.code,
    message: value.message,
    ...(value.data && typeof value.data === "object" ? { details: value.data as Record<string, unknown> } : {}),
  };
};

const toReviewError = (
  value:
    | {
        code: string;
        message: string;
        data?: unknown;
      }
    | undefined,
): TransactionReviewError | null => {
  if (!value) {
    return null;
  }

  return {
    reason: value.code,
    message: value.message,
    ...(value.data !== undefined ? { data: value.data } : {}),
  };
};

const deriveReviewState = (
  meta: TransactionMeta | undefined,
  session?: TransactionReviewSession | undefined,
): TransactionReviewState => {
  if (!session) {
    if (!meta) {
      return {
        status: "preparing",
        revision: 0,
        updatedAt: 0,
        error: null,
      };
    }

    if (!meta.prepared && meta.issues.length > 0) {
      return {
        status: "failed",
        revision: meta.updatedAt,
        updatedAt: meta.updatedAt,
        error: toReviewError(meta.issues[0]),
      };
    }

    if (!meta.prepared) {
      return {
        status: "preparing",
        revision: meta.updatedAt,
        updatedAt: meta.updatedAt,
        error: null,
      };
    }

    return {
      status: "ready",
      revision: meta.updatedAt,
      updatedAt: meta.updatedAt,
      error: null,
    };
  }

  return {
    status: session.status === "invalidated" ? "failed" : session.status,
    revision: session.revision,
    updatedAt: session.updatedAt,
    error: session.error,
  };
};

export const projectTransactionReviewState = (
  transaction: TransactionMeta | undefined,
  session?: TransactionReviewSession | undefined,
) => {
  const reviewState = deriveReviewState(transaction, session);
  const warnings = (transaction?.warnings ?? []).flatMap((warning) => {
    const projected = toReviewMessage(warning);
    return projected ? [projected] : [];
  });
  const approvalBlocker = reviewState.status === "ready" ? toReviewMessage(transaction?.issues[0]) : null;

  return {
    reviewState,
    warnings,
    approvalBlocker,
  } satisfies Pick<SendTransactionApprovalReview, "reviewState" | "warnings" | "approvalBlocker">;
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
