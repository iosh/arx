import type { ApprovalController, ApprovalFinishedEvent } from "../approval/types.js";
import { ApprovalDetailInvalidationPublisher } from "./ApprovalDetailInvalidationPublisher.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionMessenger } from "./topics.js";
import type { ApprovalDetailInvalidation, ApprovalDetailInvalidationEvents } from "./types.js";

type CreateApprovalDetailInvalidationsDeps = {
  messenger: TransactionMessenger;
  approvals: Pick<ApprovalController, "onFinished" | "listPendingIdsBySubject">;
  proposalRuntime: Pick<TransactionProposalRuntime, "onChanged" | "invalidatePrepareFromApproval">;
  recordView: Pick<TransactionRecordViewStore, "onChanged">;
  now: () => number;
};

const handleApprovalFinished = (params: {
  event: ApprovalFinishedEvent<unknown>;
  proposalRuntime: Pick<TransactionProposalRuntime, "invalidatePrepareFromApproval">;
  approvalDetailInvalidations: ApprovalDetailInvalidationPublisher;
  now: () => number;
}) => {
  const { event } = params;

  if (event.subject?.kind !== "transaction") {
    return;
  }

  const updatedAt = params.now();
  params.proposalRuntime.invalidatePrepareFromApproval(event, updatedAt);

  params.approvalDetailInvalidations.enqueue({ approvalIds: [event.approvalId] });
};

export const createApprovalDetailInvalidations = (
  deps: CreateApprovalDetailInvalidationsDeps,
): ApprovalDetailInvalidationEvents => {
  const approvalDetailInvalidations = new ApprovalDetailInvalidationPublisher({
    messenger: deps.messenger,
    approvals: deps.approvals,
  });

  deps.proposalRuntime.onChanged((transactionIds) => approvalDetailInvalidations.enqueue({ transactionIds }));
  deps.recordView.onChanged((transactionIds) => approvalDetailInvalidations.enqueue({ transactionIds }));
  deps.approvals.onFinished((event) =>
    handleApprovalFinished({
      event,
      proposalRuntime: deps.proposalRuntime,
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
