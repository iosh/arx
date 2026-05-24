import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../namespace/operations.js";
import type { TransactionProposalRuntime } from "../proposal/TransactionProposalRuntime.js";
import type { TransactionRecordRuntime } from "../record/TransactionRecordRuntime.js";
import { canStartProposalExecution } from "../status.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, type TransactionMessenger } from "../topics.js";
import { buildPrepareContext, buildSignContext, createMissingNamespaceTransactionError } from "../utils.js";
import type { TransactionExecutionAttemptPhase } from "./TransactionExecutionPipeline.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";

type ExecuteApprovedTransactionOptions = {
  canContinue?: (() => boolean) | undefined;
  setAttemptPhase?:
    | ((phase: TransactionExecutionAttemptPhase, signAbortController?: AbortController | null) => void)
    | undefined;
};

type TransactionExecutionRunnerDeps = {
  messenger: TransactionMessenger;
  proposalRuntime: Pick<TransactionProposalRuntime, "get" | "peek">;
  namespaces: NamespaceTransactions;
  submission: Pick<TransactionSubmissionStore, "recordBroadcastAccepted">;
  records: Pick<TransactionRecordRuntime, "persistBroadcastRecord">;
};

const createMissingPreparedExecutionError = () =>
  new Error("Approved transaction is missing prepared execution parameters.");

export class TransactionExecutionRunner {
  #messenger: TransactionMessenger;
  #proposalRuntime: Pick<TransactionProposalRuntime, "get" | "peek">;
  #namespaces: NamespaceTransactions;
  #submission: Pick<TransactionSubmissionStore, "recordBroadcastAccepted">;
  #records: Pick<TransactionRecordRuntime, "persistBroadcastRecord">;

  constructor(deps: TransactionExecutionRunnerDeps) {
    this.#messenger = deps.messenger;
    this.#proposalRuntime = deps.proposalRuntime;
    this.#namespaces = deps.namespaces;
    this.#submission = deps.submission;
    this.#records = deps.records;
  }

  async executeApprovedTransaction(id: string, options?: ExecuteApprovedTransactionOptions): Promise<void> {
    const setAttemptPhase = options?.setAttemptPhase ?? (() => {});
    const canContinue = options?.canContinue ?? (() => true);

    const meta = this.#proposalRuntime.get(id);
    const proposal = this.#proposalRuntime.peek(id);
    if (!meta || !proposal || !canStartProposalExecution(proposal)) {
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      setAttemptPhase("processing");
      throw createMissingNamespaceTransactionError(meta.namespace);
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
