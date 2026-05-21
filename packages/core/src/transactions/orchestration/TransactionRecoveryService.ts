import type { TransactionRecordRuntime } from "../record/TransactionRecordRuntime.js";
import type { TransactionRecoveryRuntime } from "../runtime.js";

type TransactionRecoveryServiceDeps = {
  execution: {
    resumeApprovedProposals(): Promise<void>;
  };
  records: Pick<TransactionRecordRuntime, "resumeBroadcastRecords">;
};

export const createTransactionRecoveryService = (deps: TransactionRecoveryServiceDeps): TransactionRecoveryRuntime => ({
  async resumeTransactions(): Promise<void> {
    await deps.execution.resumeApprovedProposals();
    await deps.records.resumeBroadcastRecords();
  },
});
