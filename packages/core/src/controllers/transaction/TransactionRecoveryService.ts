import type { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import type { TransactionRecovery } from "./types.js";

type TransactionRecoveryServiceDeps = {
  execution: {
    resumeApprovedProposals(): Promise<void>;
  };
  records: Pick<TransactionRecordRuntime, "resumeBroadcastRecords">;
};

export const createTransactionRecoveryService = (deps: TransactionRecoveryServiceDeps): TransactionRecovery => ({
  async resumeTransactions(): Promise<void> {
    await deps.execution.resumeApprovedProposals();
    await deps.records.resumeBroadcastRecords();
  },
});
