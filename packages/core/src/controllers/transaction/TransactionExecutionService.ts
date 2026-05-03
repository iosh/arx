import { ArxReasons, isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import type { TransactionError } from "../../transactions/types.js";
import { canStartProposalExecution, isProposalTerminal, isTransactionRecordTerminal } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalService } from "./TransactionProposalService.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionSubmissionService } from "./TransactionSubmissionService.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, type TransactionMessenger } from "./topics.js";
import type { TransactionApprovalExecutor, TransactionApprovalResult, TransactionBroadcastRecovery } from "./types.js";
import {
  buildPrepareContext,
  buildSignContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
  createTransactionPersistenceError,
  isUserRejectedError,
} from "./utils.js";

type TransactionProposalExecutionGateway = Pick<TransactionProposalService, "approveForExecution">;

type TransactionExecutionServiceDeps = {
  messenger: TransactionMessenger;
  proposalStore: TransactionProposalStore;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  submissionService: TransactionSubmissionService;
  prepare: TransactionPrepareManager;
  proposals: TransactionProposalExecutionGateway;
  tracking: TransactionReceiptTracking;
  readTransactionTimestamp: () => number;
};

type TransactionExecutionAttemptPhase = "queued" | "processing" | "signing" | "broadcasting" | "persisting_record";

type TransactionExecutionAttemptState = {
  phase: TransactionExecutionAttemptPhase;
  signAbortController: AbortController | null;
};

export class TransactionExecutionService implements TransactionApprovalExecutor, TransactionBroadcastRecovery {
  #messenger: TransactionMessenger;
  #proposalStore: TransactionProposalStore;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: NamespaceTransactions;
  #service: TransactionsService;
  #submissionService: TransactionSubmissionService;
  #prepare: TransactionPrepareManager;
  #proposals: TransactionProposalExecutionGateway;
  #tracking: TransactionReceiptTracking;
  #readTransactionTimestamp: () => number;

  #queue: string[] = [];
  #queued = new Set<string>();
  #processing = new Set<string>();
  #scheduled = false;
  #attempts = new Map<string, TransactionExecutionAttemptState>();

  constructor(deps: TransactionExecutionServiceDeps) {
    this.#messenger = deps.messenger;
    this.#proposalStore = deps.proposalStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#submissionService = deps.submissionService;
    this.#prepare = deps.prepare;
    this.#proposals = deps.proposals;
    this.#tracking = deps.tracking;
    this.#readTransactionTimestamp = deps.readTransactionTimestamp;
  }

  async approveTransaction(id: string): Promise<TransactionApprovalResult> {
    const result = this.#proposals.approveForExecution(id);
    if (result.status === "failed") {
      return result;
    }

    this.#enqueue(id);
    return result;
  }

  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#finalizeExternalCancellation(id, reason);
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
      updatedAt: this.#readTransactionTimestamp(),
      patch: {
        error: cancellation.error,
        userRejected: cancellation.userRejected,
      },
    });
    this.#submissionService.recordFailure(id, {
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

    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      return;
    }

    const latest = this.#recordView.commitRecordView(latestRecord).next;
    if (latest.status === "broadcast" && cancellation.userRejected) {
      return;
    }
    if (isTransactionRecordTerminal(latest)) {
      return;
    }

    const updated = await this.#service.transition({
      id,
      fromStatus: latest.status,
      toStatus: "failed",
    });
    if (updated) {
      const { previous, next } = this.#recordView.commitRecordView(updated);
      this.#tracking.stop(id);
      this.#tracking.handleTransition(previous, next);
    }
  }

  async processTransaction(id: string): Promise<void> {
    let meta = this.#proposalStore.get(id);
    const proposal = this.#proposalStore.peek(id);
    if (!meta || !proposal || !canStartProposalExecution(proposal)) {
      this.#attempts.delete(id);
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      this.#setAttemptPhase(id, "processing");
      await this.#finalizeExecutionFailure(id, createMissingNamespaceTransactionError(meta.namespace));
      return;
    }
    if (!namespaceTransaction.tracking) {
      this.#setAttemptPhase(id, "processing");
      await this.#finalizeExecutionFailure(id, createReceiptTrackingUnsupportedError(meta.namespace));
      return;
    }

    try {
      this.#setAttemptPhase(id, "processing");
      let prepared = meta.prepared;
      if (!prepared) {
        const next = await this.#prepare.prepareTransactionForExecution(id);
        if (!next?.prepared) {
          await this.#finalizeExecutionFailure(
            id,
            new Error("Transaction preparation did not produce prepared parameters"),
          );
          return;
        }
        prepared = next.prepared;
        meta = next;
      }
      if (!this.#canContinueAttempt(id)) {
        return;
      }

      const sign = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.sign",
        value: namespaceTransaction.execution?.sign,
      });
      const signAbortController = new AbortController();
      this.#setAttemptPhase(id, "signing", signAbortController);
      const signed = await sign(buildSignContext(meta), prepared, {
        signal: signAbortController.signal,
      });
      if (!this.#canContinueAttempt(id)) {
        return;
      }

      this.#setAttemptPhase(id, "broadcasting");
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
        locator: structuredClone(broadcast.locator),
      });
      this.#submissionService.recordSubmitted(id, {
        submitted: structuredClone(broadcast.submitted),
        locator: structuredClone(broadcast.locator),
      });

      this.#setAttemptPhase(id, "persisting_record");
      let durable: Awaited<ReturnType<TransactionsService["createSubmitted"]>>;
      try {
        if (!meta.from) {
          throw new Error(`Transaction ${meta.id} is missing a from address.`);
        }
        durable = await this.#service.createSubmitted({
          id: meta.id,
          createdAt: meta.createdAt,
          chainRef: meta.chainRef,
          origin: meta.origin,
          fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
            chainRef: meta.chainRef,
            address: meta.from,
          }),
          status: "broadcast",
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        });
      } catch (error) {
        const persistenceFailure = error instanceof Error ? error : new Error("Transaction persistence failed");
        const failure = {
          transactionId: id,
          error: createTransactionPersistenceError({
            cause: persistenceFailure,
            transactionId: id,
            submitted: broadcast.submitted,
            locator: broadcast.locator,
          }),
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        };
        this.#submissionService.recordPersistenceFailure(id, failure);
        this.#proposalStore.delete(id);
        return;
      }

      this.#proposalStore.clearProposalAfterRecordPersisted(id);

      const { previous, next } = this.#recordView.commitRecordView(durable);
      this.#tracking.handleTransition(previous, next);
    } catch (err) {
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        await this.#finalizeExecutionFailure(id, err);
        return;
      }
      await this.#finalizeExecutionFailure(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    } finally {
      this.#attempts.delete(id);
    }
  }

  async resumePending(): Promise<void> {
    this.#recordView.requestSync();
    for (const proposalId of this.#proposalStore.listExecutableProposalIds()) {
      this.#enqueue(proposalId);
    }

    const broadcast = await this.#listAllByStatus("broadcast");
    for (const record of broadcast) {
      const view = this.#recordView.commitRecordView(record).next;
      this.#tracking.resumeBroadcast(view);
    }
  }

  #enqueue(id: string) {
    if (this.#processing.has(id) || this.#queued.has(id)) return;
    this.#queued.add(id);
    this.#attempts.set(id, {
      phase: "queued",
      signAbortController: null,
    });
    this.#queue.push(id);
    this.#scheduleProcess();
  }

  #scheduleProcess() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    Promise.resolve().then(() => {
      this.#scheduled = false;
      void this.#processQueue();
    });
  }

  async #processQueue() {
    const next = this.#queue.shift();
    if (!next) return;
    this.#queued.delete(next);
    if (this.#processing.has(next)) {
      this.#scheduleProcess();
      return;
    }
    this.#processing.add(next);
    try {
      await this.processTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) {
        this.#scheduleProcess();
      }
    }
  }

  #canContinueAttempt(id: string): boolean {
    const proposal = this.#proposalStore.peek(id);
    return proposal?.phase === "approved";
  }

  #setAttemptPhase(
    id: string,
    phase: TransactionExecutionAttemptPhase,
    signAbortController: AbortController | null = null,
  ): void {
    this.#attempts.set(id, {
      phase,
      signAbortController,
    });
  }

  #removeFromQueue(id: string): void {
    this.#queued.delete(id);
    if (this.#queue.length === 0) {
      return;
    }
    this.#queue = this.#queue.filter((queuedId) => queuedId !== id);
  }

  #isIrreversibleAttempt(phase: TransactionExecutionAttemptPhase | undefined): boolean {
    return phase === "broadcasting" || phase === "persisting_record";
  }

  async #finalizeExternalCancellation(id: string, reason?: Error | TransactionError): Promise<void> {
    const cancellation = this.#buildCancellationState(reason);
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || isProposalTerminal(proposal)) {
      return;
    }

    this.#removeFromQueue(id);
    const attempt = this.#attempts.get(id) ?? null;
    if (attempt) {
      if (attempt.phase === "signing") {
        attempt.signAbortController?.abort(reason);
      }
      if (this.#isIrreversibleAttempt(attempt.phase)) {
        return;
      }
    }

    this.#failActiveProposal(id, cancellation);
  }

  async #listAllByStatus(status: "broadcast" | "confirmed" | "failed" | "replaced") {
    const out = [];
    let cursor: ListTransactionsCursor | undefined;

    while (true) {
      const page = await this.#service.list({
        status,
        limit: 200,
        ...(cursor !== undefined ? { before: cursor } : {}),
      });
      if (page.length === 0) break;
      out.push(...page);
      const tail = page.at(-1);
      cursor = tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
      if (cursor === undefined) break;
    }

    return out;
  }
}
