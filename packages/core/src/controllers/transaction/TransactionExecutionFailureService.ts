import type { TransactionError } from "../../transactions/types.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import type { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import { coerceTransactionError, isUserRejectedError } from "./utils.js";

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

  async finalizeExecutionFailure(id: string, reason?: Error | TransactionError): Promise<void> {
    const cancellation = this.#buildCancellationState(reason);
    if (this.#failActiveProposal(id, cancellation)) {
      return;
    }

    await this.#records.failRecord(id, reason);
  }

  #buildCancellationState(reason?: Error | TransactionError) {
    const error = coerceTransactionError(reason) ?? null;
    return {
      error,
      userRejected: isUserRejectedError(reason, error ?? undefined),
    };
  }

  #failActiveProposal(
    id: string,
    cancellation: {
      error: TransactionError | null;
      userRejected: boolean;
    },
  ): boolean {
    const failed = this.#proposalRuntime.failProposal({
      id,
      updatedAt: this.#now(),
      error: cancellation.error,
      userRejected: cancellation.userRejected,
    });
    if (failed.status !== "failed") {
      return false;
    }

    this.#submission.recordFailure(id, {
      transactionId: id,
      error: cancellation.error,
      userRejected: cancellation.userRejected,
      message: cancellation.error?.message ?? "Transaction submission failed",
    });
    return true;
  }
}
