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
import { TRANSACTION_SUBMITTED, type TransactionMessenger } from "./topics.js";
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
  #cancelledByUser = new Set<string>();
  #broadcasting = new Set<string>();
  #broadcastedPendingPersist = new Set<string>();

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
    const error = coerceTransactionError(reason) ?? null;
    const wantsUserRejected = isUserRejectedError(reason, error ?? undefined);
    if (wantsUserRejected) {
      this.#cancelledByUser.add(id);
    }

    const proposal = this.#proposalStore.peek(id);
    if (proposal && !isProposalTerminal(proposal)) {
      this.#queued.delete(id);
      if (this.#broadcasting.has(id) || this.#broadcastedPendingPersist.has(id)) {
        this.#cancelledByUser.delete(id);
        return;
      }
      this.#proposalStore.failProposalBeforeBroadcast({
        id,
        updatedAt: this.#readTransactionTimestamp(),
        patch: {
          error,
          userRejected: wantsUserRejected,
        },
      });
      this.#cancelledByUser.delete(id);
      return;
    }

    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      this.#cancelledByUser.delete(id);
      return;
    }

    const latest = this.#recordView.commitRecordView(latestRecord).next;
    if (latest.status === "broadcast" && wantsUserRejected) {
      this.#cancelledByUser.delete(id);
      return;
    }
    if (isTransactionRecordTerminal(latest)) {
      this.#cancelledByUser.delete(id);
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
    this.#cancelledByUser.delete(id);
  }

  async processTransaction(id: string): Promise<void> {
    if (this.#isCancelled(id)) {
      return;
    }

    let meta = this.#proposalStore.get(id);
    const proposal = this.#proposalStore.peek(id);
    if (!meta || !proposal || !canStartProposalExecution(proposal)) {
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      await this.rejectTransaction(id, createMissingNamespaceTransactionError(meta.namespace));
      return;
    }
    if (!namespaceTransaction.tracking) {
      await this.rejectTransaction(id, createReceiptTrackingUnsupportedError(meta.namespace));
      return;
    }

    try {
      let prepared = meta.prepared;
      if (!prepared) {
        const next = await this.#prepare.prepareTransactionForExecution(id);
        if (!next?.prepared) {
          await this.rejectTransaction(id, new Error("Transaction preparation did not produce prepared parameters"));
          return;
        }
        prepared = next.prepared;
        meta = next;
      }

      const executingMeta = this.#proposalStore.startExecution({
        id,
        updatedAt: this.#readTransactionTimestamp(),
      });
      if (!executingMeta) {
        return;
      }
      meta = executingMeta;

      const sign = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.sign",
        value: namespaceTransaction.execution?.sign,
      });
      const signed = await sign(buildSignContext(meta), prepared);
      if (this.#proposalStore.peek(id)?.phase !== "executing") return;

      if (this.#isCancelled(id)) {
        return;
      }

      this.#broadcasting.add(id);
      const broadcastTransaction = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.broadcast",
        value: namespaceTransaction.execution?.broadcast,
      });
      let broadcast: Awaited<ReturnType<typeof broadcastTransaction>>;
      try {
        broadcast = await broadcastTransaction(buildPrepareContext(meta), signed, prepared);
      } finally {
        this.#broadcasting.delete(id);
      }
      this.#broadcastedPendingPersist.add(id);
      if (this.#proposalStore.peek(id)?.phase !== "executing") {
        return;
      }
      this.#messenger.publish(TRANSACTION_SUBMITTED, {
        id,
        submitted: structuredClone(broadcast.submitted),
        locator: structuredClone(broadcast.locator),
      });

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
        this.#proposalStore.failExecutingProposal({
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
        await this.rejectTransaction(id, err);
        return;
      }
      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    } finally {
      this.#broadcastedPendingPersist.delete(id);
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

  #isCancelled(id: string): boolean {
    return this.#cancelledByUser.has(id);
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
