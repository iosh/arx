import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canStartProposalExecution } from "./status.js";
import type { TransactionExecutionAttemptPhase } from "./TransactionExecutionPipeline.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, type TransactionMessenger } from "./topics.js";
import {
  buildPrepareContext,
  buildSignContext,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
} from "./utils.js";

type ExecuteApprovedTransactionOptions = {
  canContinue?: (() => boolean) | undefined;
  setAttemptPhase?:
    | ((phase: TransactionExecutionAttemptPhase, signAbortController?: AbortController | null) => void)
    | undefined;
};

type TransactionExecutionRunnerDeps = {
  messenger: TransactionMessenger;
  proposalStore: Pick<TransactionProposalStore, "get" | "peek">;
  namespaces: NamespaceTransactions;
  submission: Pick<TransactionSubmissionStore, "recordBroadcastAccepted">;
  records: Pick<TransactionRecordRuntime, "persistBroadcastRecord">;
};

const createMissingPreparedExecutionError = () =>
  new Error("Approved transaction is missing prepared execution parameters.");

export class TransactionExecutionRunner {
  #messenger: TransactionMessenger;
  #proposalStore: Pick<TransactionProposalStore, "get" | "peek">;
  #namespaces: NamespaceTransactions;
  #submission: Pick<TransactionSubmissionStore, "recordBroadcastAccepted">;
  #records: Pick<TransactionRecordRuntime, "persistBroadcastRecord">;

  constructor(deps: TransactionExecutionRunnerDeps) {
    this.#messenger = deps.messenger;
    this.#proposalStore = deps.proposalStore;
    this.#namespaces = deps.namespaces;
    this.#submission = deps.submission;
    this.#records = deps.records;
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
      throw createMissingNamespaceTransactionError(meta.namespace);
    }
    if (!namespaceTransaction.tracking) {
      setAttemptPhase("processing");
      throw createReceiptTrackingUnsupportedError(meta.namespace);
    }

    setAttemptPhase("processing");
    const prepared = meta.prepared;
    if (!prepared) {
      if (!canContinue()) {
        return;
      }
      throw createMissingPreparedExecutionError();
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
    this.#submission.recordBroadcastAccepted(id, {
      submitted: structuredClone(broadcast.submitted),
    });

    setAttemptPhase("persisting_record");
    await this.#records.persistBroadcastRecord(meta, structuredClone(broadcast.submitted));
  }
}
