import { ArxReasons, isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canStartProposalExecution, isProposalTerminal, isTransactionRecordTerminal } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalService } from "./TransactionProposalService.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, type TransactionMessenger } from "./topics.js";
import type { TransactionApproveResult, TransactionController, TransactionError } from "./types.js";
import {
  buildPrepareContext,
  buildSignContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
  createTransactionPersistenceError,
  isUserRejectedError,
} from "./utils.js";

type TransactionProposalExecutionGateway = Pick<
  TransactionProposalService,
  "approveForExecution" | "deleteReviewSession"
>;

type TransactionExecutionServiceDeps = {
  messenger: TransactionMessenger;
  proposalStore: TransactionProposalStore;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  prepare: TransactionPrepareManager;
  proposals: TransactionProposalExecutionGateway;
  tracking: TransactionReceiptTracking;
  readTransactionTimestamp: () => number;
};

type TransactionExecutionAttemptPhase = "queued" | "processing" | "signing" | "broadcasting" | "persisting_record";

export class TransactionExecutionService
  implements Pick<TransactionController, "approveTransaction" | "rejectTransaction" | "resumePending">
{
  #messenger: TransactionMessenger;
  #proposalStore: TransactionProposalStore;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: NamespaceTransactions;
  #service: TransactionsService;
  #prepare: TransactionPrepareManager;
  #proposals: TransactionProposalExecutionGateway;
  #tracking: TransactionReceiptTracking;
  #readTransactionTimestamp: () => number;

  #queue: string[] = [];
  #queued = new Set<string>();
  #processing = new Set<string>();
  #scheduled = false;
  #attempts = new Map<string, TransactionExecutionAttemptPhase>();

  constructor(deps: TransactionExecutionServiceDeps) {
    this.#messenger = deps.messenger;
    this.#proposalStore = deps.proposalStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#prepare = deps.prepare;
    this.#proposals = deps.proposals;
    this.#tracking = deps.tracking;
    this.#readTransactionTimestamp = deps.readTransactionTimestamp;
  }

  async approveTransaction(id: string): Promise<TransactionApproveResult> {
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

  async #finalizeProposalFailure(
    id: string,
    reason: Error | TransactionError | undefined,
    source: "external" | "internal",
  ): Promise<void> {
    const error = coerceTransactionError(reason) ?? null;
    const wantsUserRejected = isUserRejectedError(reason, error ?? undefined);

    const proposal = this.#proposalStore.peek(id);
    if (proposal && !isProposalTerminal(proposal)) {
      this.#queued.delete(id);
      const attemptPhase = this.#attempts.get(id);
      if (source === "external" && this.#shouldIgnoreIrreversibleAttemptCancellation(attemptPhase)) {
        return;
      }
      this.#proposalStore.failProposal({
        id,
        updatedAt: this.#readTransactionTimestamp(),
        patch: {
          error,
          userRejected: wantsUserRejected,
        },
      });
      return;
    }

    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      return;
    }

    const latest = this.#recordView.commitRecordView(latestRecord).next;
    if (latest.status === "broadcast" && wantsUserRejected) {
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
      this.#attempts.set(id, "processing");
      await this.#finalizeExecutionFailure(id, createMissingNamespaceTransactionError(meta.namespace));
      return;
    }
    if (!namespaceTransaction.tracking) {
      this.#attempts.set(id, "processing");
      await this.#finalizeExecutionFailure(id, createReceiptTrackingUnsupportedError(meta.namespace));
      return;
    }

    try {
      this.#attempts.set(id, "processing");
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
      this.#attempts.set(id, "signing");
      const signed = await sign(buildSignContext(meta), prepared);
      if (!this.#canContinueAttempt(id)) {
        return;
      }

      this.#attempts.set(id, "broadcasting");
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

      this.#attempts.set(id, "persisting_record");
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
        this.#proposalStore.failProposal({
          id,
          updatedAt: this.#readTransactionTimestamp(),
          patch: {
            error: createTransactionPersistenceError({
              cause: persistenceFailure,
              transactionId: id,
              submitted: broadcast.submitted,
              locator: broadcast.locator,
            }),
          },
        });
        return;
      }

      this.#proposalStore.clearProposalAfterRecordPersisted(id);
      this.#proposals.deleteReviewSession(id);

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
    this.#attempts.set(id, "queued");
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

  #shouldIgnoreIrreversibleAttemptCancellation(attemptPhase: TransactionExecutionAttemptPhase | undefined): boolean {
    return attemptPhase === "broadcasting" || attemptPhase === "persisting_record";
  }

  async #finalizeExternalCancellation(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#finalizeProposalFailure(id, reason, "external");
  }

  async #finalizeExecutionFailure(id: string, reason?: Error | TransactionError): Promise<void> {
    return this.#finalizeProposalFailure(id, reason, "internal");
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
