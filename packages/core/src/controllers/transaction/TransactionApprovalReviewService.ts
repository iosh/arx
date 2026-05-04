import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { buildSendTransactionApprovalReview } from "./review/projector.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import type { TransactionApprovalReviewReader } from "./types.js";
import { buildProposalStateContext } from "./utils.js";

type CreateTransactionApprovalReviewReaderDeps = {
  proposalStore: TransactionProposalStore;
  reviewSessions: TransactionReviewSessionStore;
  namespaces: NamespaceTransactions;
};

export const createTransactionApprovalReviewReader = (
  deps: CreateTransactionApprovalReviewReaderDeps,
): TransactionApprovalReviewReader => {
  return {
    getTransactionApprovalReview(transactionId: string) {
      const proposalMeta = deps.proposalStore.get(transactionId);
      if (!proposalMeta) {
        throw new Error(`Transaction ${transactionId} is missing an active proposal.`);
      }

      const reviewState = deps.reviewSessions.get(transactionId);
      if (!reviewState) {
        throw new Error(`Transaction ${transactionId} is missing an active review session.`);
      }

      const namespaceTransaction = deps.namespaces.get(proposalMeta.namespace);
      if (!namespaceTransaction) {
        throw new Error(`Transaction ${transactionId} is missing namespace transaction "${proposalMeta.namespace}".`);
      }

      const buildReview = requireNamespaceTransactionOperation({
        namespace: proposalMeta.namespace,
        operation: "proposal.buildReview",
        value: namespaceTransaction.proposal?.buildReview,
      });

      return buildSendTransactionApprovalReview({
        updatedAt: reviewState.updatedAt,
        review: reviewState,
        namespaceReview: buildReview({
          ...buildProposalStateContext(proposalMeta),
          reviewPreparedSnapshot: reviewState.reviewPreparedSnapshot,
        }),
      });
    },
  };
};
