import type { ApprovalController, ApprovalFinishedEvent } from "../../controllers/approval/types.js";
import type { TransactionProposalRuntime } from "../proposal/TransactionProposalRuntime.js";
import type { TransactionRecordViewStore } from "../record/TransactionRecordViewStore.js";
import type { ApprovalDetailInvalidation, ApprovalDetailInvalidationEvents } from "../runtime.js";
import type { TransactionMessenger } from "../topics.js";
import { ApprovalDetailInvalidationPublisher } from "./ApprovalDetailInvalidationPublisher.js";

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
  deps.approvals.onFinished((event: ApprovalFinishedEvent<unknown>) =>
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
