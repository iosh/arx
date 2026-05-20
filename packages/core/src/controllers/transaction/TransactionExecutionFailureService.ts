import type { TransactionRecordRuntime } from "../../transactions/record/TransactionRecordRuntime.js";
import type { TransactionError } from "../../transactions/types.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { TransactionProposalTerminationReason } from "./types.js";
import { coerceTransactionError } from "./utils.js";

type TransactionExecutionFailureServiceDeps = {
  proposalRuntime: Pick<TransactionProposalRuntime, "failProposal">;
  submission: Pick<TransactionSubmissionStore, "recordFailure">;
  records: Pick<TransactionRecordRuntime, "failRecord">;
  now: () => number;
};

export class TransactionExecutionFailureService {
  #proposalRuntime: Pick<TransactionProposalRuntime, "failProposal">;
  #submission: Pick<TransactionSubmissionStore, "recordFailure">;
  #records: Pick<TransactionRecordRuntime, "failRecord">;
  #now: () => number;

  constructor(deps: TransactionExecutionFailureServiceDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
    this.#submission = deps.submission;
    this.#records = deps.records;
    this.#now = deps.now;
  }

  async finalizeExecutionFailure(input: {
    id: string;
    reason?: Error | TransactionError;
    terminationReason: TransactionProposalTerminationReason;
  }): Promise<void> {
    const failure = this.#buildFailureState(input.reason, input.terminationReason);
    if (this.#failActiveProposal(input.id, failure)) {
      return;
    }

    await this.#records.failRecord(input.id, input.reason);
  }

  #buildFailureState(
    reason: Error | TransactionError | undefined,
    terminationReason: TransactionProposalTerminationReason,
  ) {
    const error = coerceTransactionError(reason) ?? null;
    return {
      error,
      terminationReason,
      userRejected: terminationReason === "user_rejected",
    };
  }

  #failActiveProposal(
    id: string,
    failure: {
      error: TransactionError | null;
      terminationReason: TransactionProposalTerminationReason;
      userRejected: boolean;
    },
  ): boolean {
    const failed = this.#proposalRuntime.failProposal({
      id,
      updatedAt: this.#now(),
      error: failure.error,
      terminationReason: failure.terminationReason,
    });
    if (failed.status !== "failed") {
      return false;
    }

    this.#submission.recordFailure(id, {
      transactionId: id,
      error: failure.error,
      terminationReason: failure.terminationReason,
      userRejected: failure.userRejected,
      message: failure.error?.message ?? "Transaction submission failed",
    });
    return true;
  }
}
