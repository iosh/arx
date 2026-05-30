import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { TransactionApprovalReviewReader } from "../proposal/types.js";
import { buildSendTransactionApprovalReview } from "../review/projector.js";
import { buildProposalStateContext } from "../utils.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

type CreateTransactionApprovalReviewReaderDeps = {
  proposalRuntime: Pick<TransactionProposalRuntime, "get" | "getReviewState">;
  namespaces: NamespaceTransactions;
};

export const createTransactionApprovalReviewReader = (
  deps: CreateTransactionApprovalReviewReaderDeps,
): TransactionApprovalReviewReader => {
  return {
    getTransactionApprovalReview(transactionId: string) {
      const proposalMeta = deps.proposalRuntime.get(transactionId);
      if (!proposalMeta) {
        throw new Error(`Transaction ${transactionId} is missing an active proposal.`);
      }

      const reviewState = deps.proposalRuntime.getReviewState(transactionId);
      if (!reviewState) {
        throw new Error(`Transaction ${transactionId} is missing an active review state.`);
      }

      const namespaceTransaction = deps.namespaces.get(proposalMeta.namespace);
      if (!namespaceTransaction) {
        throw new Error(`Transaction ${transactionId} is missing namespace transaction "${proposalMeta.namespace}".`);
      }

      return buildSendTransactionApprovalReview({
        updatedAt: reviewState.updatedAt,
        review: reviewState,
        details:
          namespaceTransaction.proposal?.buildReview?.({
            ...buildProposalStateContext(proposalMeta),
            reviewSnapshot: reviewState.reviewSnapshot,
          }) ?? null,
      });
    },
  };
};
