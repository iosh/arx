import type { TransactionProposalStatus } from "./proposal/index.js";
import type { TransactionProposalSnapshot } from "./proposal/types.js";
import type { TransactionRecordStatus, TransactionRecordView } from "./record/index.js";
import type { TransactionSubmitted } from "./types.js";

export type TransactionProposalStatusChange = {
  kind: "proposal_status";
  id: string;
  previousStatus: TransactionProposalStatus;
  nextStatus: TransactionProposalStatus;
  proposal: TransactionProposalSnapshot;
};

export type TransactionRecordStatusChange = {
  kind: "record_status";
  id: string;
  previousStatus: TransactionRecordStatus | null;
  nextStatus: TransactionRecordStatus;
  record: TransactionRecordView;
};

export type TransactionStatusChange = TransactionProposalStatusChange | TransactionRecordStatusChange;

export type ApprovalDetailInvalidation = {
  approvalIds: string[];
};

export type TransactionSubmittedChange = {
  id: string;
  submitted: TransactionSubmitted;
};

export type TransactionBroadcastStartedChange = {
  id: string;
};
