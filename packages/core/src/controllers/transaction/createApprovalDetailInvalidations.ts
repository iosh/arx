import type { ApprovalController, ApprovalFinishedEvent } from "../approval/types.js";
import { ApprovalDetailInvalidationPublisher } from "./ApprovalDetailInvalidationPublisher.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import type { TransactionMessenger } from "./topics.js";
import type { ApprovalDetailInvalidation, ApprovalDetailInvalidationEvents } from "./types.js";

type CreateApprovalDetailInvalidationsDeps = {
  messenger: TransactionMessenger;
  approvals: Pick<ApprovalController, "onFinished" | "listPendingIdsBySubject">;
  proposalStore: Pick<TransactionProposalStore, "onChanged" | "peek" | "updatePreparedForDraft">;
  reviewStore: Pick<TransactionReviewSessionStore, "onChanged" | "invalidatePrepareFromApproval">;
  recordView: Pick<TransactionRecordViewStore, "onChanged">;
  now: () => number;
};

const clearPreparedAfterInvalidation = (params: {
  proposalStore: Pick<TransactionProposalStore, "peek" | "updatePreparedForDraft">;
  transactionId: string;
  updatedAt: number;
}) => {
  const proposal = params.proposalStore.peek(params.transactionId);
  if (!proposal) {
    return;
  }

  params.proposalStore.updatePreparedForDraft({
    id: params.transactionId,
    expectedDraftRevision: proposal.draftRevision,
    updatedAt: params.updatedAt,
    prepared: null,
  });
};

const handleApprovalFinished = (params: {
  event: ApprovalFinishedEvent<unknown>;
  reviewStore: Pick<TransactionReviewSessionStore, "invalidatePrepareFromApproval">;
  proposalStore: Pick<TransactionProposalStore, "peek" | "updatePreparedForDraft">;
  approvalDetailInvalidations: ApprovalDetailInvalidationPublisher;
  now: () => number;
}) => {
  const { event } = params;

  if (event.subject?.kind !== "transaction") {
    return;
  }

  const updatedAt = params.now();
  const invalidated = params.reviewStore.invalidatePrepareFromApproval(event, updatedAt);
  if (invalidated) {
    clearPreparedAfterInvalidation({
      proposalStore: params.proposalStore,
      transactionId: event.subject.transactionId,
      updatedAt,
    });
  }

  params.approvalDetailInvalidations.enqueue({ approvalIds: [event.approvalId] });
};

export const createApprovalDetailInvalidations = (
  deps: CreateApprovalDetailInvalidationsDeps,
): ApprovalDetailInvalidationEvents => {
  const approvalDetailInvalidations = new ApprovalDetailInvalidationPublisher({
    messenger: deps.messenger,
    approvals: deps.approvals,
  });

  deps.proposalStore.onChanged((transactionIds) => approvalDetailInvalidations.enqueue({ transactionIds }));
  deps.reviewStore.onChanged((transactionIds) => approvalDetailInvalidations.enqueue({ transactionIds }));
  deps.recordView.onChanged((transactionIds) => approvalDetailInvalidations.enqueue({ transactionIds }));
  deps.approvals.onFinished((event) =>
    handleApprovalFinished({
      event,
      reviewStore: deps.reviewStore,
      proposalStore: deps.proposalStore,
      approvalDetailInvalidations,
      now: deps.now,
    }),
  );

  return {
    onChanged(handler: (change: ApprovalDetailInvalidation) => void): () => void {
      return approvalDetailInvalidations.onChanged(handler);
    },
  };
};
