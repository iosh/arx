import type { TransactionProposalStatus } from "./proposal/index.js";
import type { TransactionRecordStatus } from "./record/index.js";

type TransactionProposalStateRef = {
  status: TransactionProposalStatus;
};

type TransactionRecordStateRef = {
  status: TransactionRecordStatus;
};

export const isProposalTerminal = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.status === "terminated";
};

export const canStartProposalExecution = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.status === "approved";
};

export const canPrepareProposal = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.status === "active" || proposal.status === "approved";
};

export const isTransactionRecordTerminal = (record: TransactionRecordStateRef): boolean => {
  switch (record.status) {
    case "confirmed":
    case "failed":
    case "replaced":
      return true;
    case "broadcast":
      return false;
  }
};
