import type { TransactionProposalPhase, TransactionRecordStatus } from "./types.js";

type TransactionProposalStateRef = {
  phase: TransactionProposalPhase;
};

type TransactionRecordStateRef = {
  status: TransactionRecordStatus;
};

export const isProposalTerminal = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.phase === "invalidated" || proposal.phase === "failed" || proposal.phase === "unpersisted";
};

export const canStartProposalExecution = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.phase === "approved";
};

export const canPrepareProposal = (proposal: TransactionProposalStateRef): boolean => {
  return proposal.phase === "pending" || proposal.phase === "approved";
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
