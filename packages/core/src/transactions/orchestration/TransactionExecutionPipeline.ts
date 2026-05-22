import { ArxReasons, isArxError } from "@arx/errors";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { TransactionProposalTerminationReason } from "../proposal/index.js";
import type { TransactionProposalRuntime } from "../proposal/TransactionProposalRuntime.js";
import type { TransactionRecordRuntime } from "../record/TransactionRecordRuntime.js";
import type { TransactionMessenger } from "../topics.js";
import type { TransactionError } from "../types.js";
import { deriveExecutionTerminationReason } from "../utils.js";
import { TransactionExecutionFailureService } from "./TransactionExecutionFailureService.js";
import { TransactionExecutionRunner } from "./TransactionExecutionRunner.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";

export type TransactionExecutionAttemptPhase =
  | "queued"
  | "processing"
  | "signing"
  | "broadcasting"
  | "persisting_record";

type TransactionExecutionPipelineDeps = {
  messenger: TransactionMessenger;
  proposalRuntime: TransactionProposalRuntime;
  namespaces: NamespaceTransactions;
  submission: Pick<TransactionSubmissionStore, "recordBroadcastAccepted" | "recordFailure">;
  records: Pick<TransactionRecordRuntime, "persistBroadcastRecord" | "failRecord">;
  now: () => number;
};

type ExecuteApprovedTransactionOptions = {
  canContinue?: (() => boolean) | undefined;
  setAttemptPhase?:
    | ((phase: TransactionExecutionAttemptPhase, signAbortController?: AbortController | null) => void)
    | undefined;
};

export class TransactionExecutionPipeline {
  #runner: TransactionExecutionRunner;
  #failure: TransactionExecutionFailureService;

  constructor(deps: TransactionExecutionPipelineDeps) {
    this.#runner = new TransactionExecutionRunner({
      messenger: deps.messenger,
      proposalRuntime: deps.proposalRuntime,
      namespaces: deps.namespaces,
      submission: deps.submission,
      records: deps.records,
    });
    this.#failure = new TransactionExecutionFailureService({
      proposalRuntime: deps.proposalRuntime,
      submission: deps.submission,
      records: deps.records,
      now: deps.now,
    });
  }

  async executeApprovedTransaction(id: string, options?: ExecuteApprovedTransactionOptions): Promise<void> {
    try {
      await this.#runner.executeApprovedTransaction(id, options);
    } catch (error) {
      if (error && isArxError(error) && error.reason === ArxReasons.SessionLocked) {
        await this.#failure.finalizeExecutionFailure({
          id,
          reason: error,
          terminationReason: "execution_failed",
        });
        return;
      }

      const transactionError = error instanceof Error ? error : new Error("Transaction processing failed");
      await this.#failure.finalizeExecutionFailure({
        id,
        reason: transactionError,
        terminationReason: deriveExecutionTerminationReason(error),
      });
    }
  }

  async rejectTransaction(input: {
    id: string;
    reason?: Error | TransactionError;
    terminationReason: TransactionProposalTerminationReason;
  }): Promise<void> {
    await this.#failure.finalizeExecutionFailure(input);
  }
}
