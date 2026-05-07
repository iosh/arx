import { ArxReasons, isArxError } from "@arx/errors";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import type { TransactionError } from "../../transactions/types.js";
import { canStartProposalExecution, isProposalTerminal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordService } from "./TransactionRecordService.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, type TransactionMessenger } from "./topics.js";
import {
  buildPrepareContext,
  buildSignContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
  isUserRejectedError,
} from "./utils.js";

export type TransactionExecutionAttemptPhase =
  | "queued"
  | "processing"
  | "signing"
  | "broadcasting"
  | "persisting_record";

type TransactionExecutionPipelineDeps = {
  messenger: TransactionMessenger;
  proposalStore: TransactionProposalStore;
  namespaces: NamespaceTransactions;
  submission: Pick<TransactionSubmissionStore, "recordSubmitted" | "recordPersistenceFailure" | "recordFailure">;
  records: Pick<TransactionRecordService, "persistBroadcastRecord" | "failRecord">;
  now: () => number;
};

type ExecuteApprovedTransactionOptions = {
  canContinue?: (() => boolean) | undefined;
  setAttemptPhase?:
    | ((phase: TransactionExecutionAttemptPhase, signAbortController?: AbortController | null) => void)
    | undefined;
};

const createMissingPreparedExecutionError = () =>
  new Error("Approved transaction is missing prepared execution parameters.");

export class TransactionExecutionPipeline {
  #messenger: TransactionMessenger;
  #proposalStore: TransactionProposalStore;
  #namespaces: NamespaceTransactions;
  #submission: Pick<TransactionSubmissionStore, "recordSubmitted" | "recordPersistenceFailure" | "recordFailure">;
  #records: Pick<TransactionRecordService, "persistBroadcastRecord" | "failRecord">;
  #now: () => number;

  constructor(deps: TransactionExecutionPipelineDeps) {
    this.#messenger = deps.messenger;
    this.#proposalStore = deps.proposalStore;
    this.#namespaces = deps.namespaces;
    this.#submission = deps.submission;
    this.#records = deps.records;
    this.#now = deps.now;
  }

  async executeApprovedTransaction(id: string, options?: ExecuteApprovedTransactionOptions): Promise<void> {
    const setAttemptPhase = options?.setAttemptPhase ?? (() => {});
    const canContinue = options?.canContinue ?? (() => true);

    const meta = this.#proposalStore.get(id);
    const proposal = this.#proposalStore.peek(id);
    if (!meta || !proposal || !canStartProposalExecution(proposal)) {
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      setAttemptPhase("processing");
      await this.#finalizeExecutionFailure(id, createMissingNamespaceTransactionError(meta.namespace));
      return;
    }
    if (!namespaceTransaction.tracking) {
      setAttemptPhase("processing");
      await this.#finalizeExecutionFailure(id, createReceiptTrackingUnsupportedError(meta.namespace));
      return;
    }

    try {
      setAttemptPhase("processing");
      const prepared = meta.prepared;
      if (!prepared) {
        if (!canContinue()) {
          return;
        }
        await this.#finalizeExecutionFailure(id, createMissingPreparedExecutionError());
        return;
      }
      if (!canContinue()) {
        return;
      }

      const sign = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.sign",
        value: namespaceTransaction.execution?.sign,
      });
      const signAbortController = new AbortController();
      setAttemptPhase("signing", signAbortController);
      const signed = await sign(buildSignContext(meta), prepared, {
        signal: signAbortController.signal,
      });
      if (!canContinue()) {
        return;
      }

      setAttemptPhase("broadcasting");
      this.#messenger.publish(TRANSACTION_BROADCAST_STARTED, { id });
      const broadcastTransaction = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.broadcast",
        value: namespaceTransaction.execution?.broadcast,
      });
      const broadcast = await broadcastTransaction(buildPrepareContext(meta), signed, prepared);

      this.#messenger.publish(TRANSACTION_SUBMITTED, {
        id,
        submitted: structuredClone(broadcast.submitted),
      });
      this.#submission.recordSubmitted(id, {
        submitted: structuredClone(broadcast.submitted),
      });

      setAttemptPhase("persisting_record");
      await this.#records.persistBroadcastRecord(meta, structuredClone(broadcast.submitted));
    } catch (error) {
      if (error && isArxError(error) && error.reason === ArxReasons.SessionLocked) {
        await this.#finalizeExecutionFailure(id, error);
        return;
      }

      await this.#finalizeExecutionFailure(
        id,
        error instanceof Error ? error : new Error("Transaction processing failed"),
      );
    }
  }

  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    await this.#finalizeExecutionFailure(id, reason);
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
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || isProposalTerminal(proposal)) {
      return false;
    }

    this.#proposalStore.failProposal({
      id,
      updatedAt: this.#now(),
      patch: {
        error: cancellation.error,
        userRejected: cancellation.userRejected,
      },
    });
    this.#submission.recordFailure(id, {
      transactionId: id,
      error: cancellation.error,
      userRejected: cancellation.userRejected,
      message: cancellation.error?.message ?? "Transaction submission failed",
    });
    return true;
  }

  async #finalizeExecutionFailure(id: string, reason?: Error | TransactionError): Promise<void> {
    const cancellation = this.#buildCancellationState(reason);
    if (this.#failActiveProposal(id, cancellation)) {
      return;
    }

    await this.#records.failRecord(id, reason);
  }
}
