import { ArxReasons, isArxError } from "@arx/errors";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import type { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isExecutableTransactionStatus, isTerminalTransactionStatus } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalService } from "./TransactionProposalService.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type { TransactionApproveResult, TransactionController, TransactionError } from "./types.js";
import {
  buildPrepareContext,
  buildSignContext,
  coerceTransactionError,
  createMissingNamespaceTransactionError,
  createReceiptTrackingUnsupportedError,
  isUserRejectedError,
} from "./utils.js";

type TransactionProposalExecutionGateway = Pick<
  TransactionProposalService,
  "approveForExecution" | "deleteReviewSession"
>;

type TransactionExecutionServiceDeps = {
  runtime: RuntimeTransactionStore;
  view: StoreTransactionView;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  prepare: TransactionPrepareManager;
  proposals: TransactionProposalExecutionGateway;
  tracking: TransactionReceiptTracking;
  readTransactionTimestamp: () => number;
};

export class TransactionExecutionService
  implements
    Pick<TransactionController, "approveTransaction" | "rejectTransaction" | "processTransaction" | "resumePending">
{
  #runtime: RuntimeTransactionStore;
  #view: StoreTransactionView;
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

  constructor(deps: TransactionExecutionServiceDeps) {
    this.#runtime = deps.runtime;
    this.#view = deps.view;
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

    const runtime = this.#runtime.get(id);
    if (runtime && !isTerminalTransactionStatus(runtime.status)) {
      this.#queued.delete(id);
      if (runtime.status === "broadcast" || this.#broadcasting.has(id)) {
        this.#cancelledByUser.delete(id);
        return;
      }
      this.#runtime.transition({
        id,
        fromStatus: ["pending", "approved", "signed"],
        toStatus: "failed",
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

    const latest = this.#view.commitRecord(latestRecord).next;
    if (
      latest.status !== "broadcast" &&
      latest.status !== "confirmed" &&
      latest.status !== "failed" &&
      latest.status !== "replaced"
    ) {
      this.#cancelledByUser.delete(id);
      return;
    }
    if (latest.status === "broadcast" && wantsUserRejected) {
      this.#cancelledByUser.delete(id);
      return;
    }
    if (isTerminalTransactionStatus(latest.status)) {
      this.#cancelledByUser.delete(id);
      return;
    }

    const updated = await this.#service.transition({
      id,
      fromStatus: latest.status,
      toStatus: "failed",
    });
    if (updated) {
      const { previous, next } = this.#view.commitRecord(updated);
      this.#tracking.stop(id);
      this.#tracking.handleTransition(previous, next);
    }
    this.#cancelledByUser.delete(id);
  }

  async processTransaction(id: string): Promise<void> {
    if (this.#isCancelled(id)) {
      return;
    }

    let meta = this.#runtime.get(id);
    if (!meta || !isExecutableTransactionStatus(meta.status)) {
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

      const sign = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "execution.sign",
        value: namespaceTransaction.execution?.sign,
      });
      const signed = await sign(buildSignContext(meta), prepared);
      const signedMeta = this.#runtime.transition({
        id,
        fromStatus: meta.status,
        toStatus: "signed",
        updatedAt: this.#readTransactionTimestamp(),
      });
      if (!signedMeta) {
        return;
      }

      if (this.#isCancelled(id)) {
        return;
      }

      this.#broadcasting.add(id);
      const broadcastTransaction = requireNamespaceTransactionOperation({
        namespace: signedMeta.namespace,
        operation: "execution.broadcast",
        value: namespaceTransaction.execution?.broadcast,
      });
      let broadcast: Awaited<ReturnType<typeof broadcastTransaction>>;
      try {
        broadcast = await broadcastTransaction(buildPrepareContext(signedMeta), signed, prepared);
      } finally {
        this.#broadcasting.delete(id);
      }
      const broadcastMeta = this.#runtime.transition({
        id,
        fromStatus: "signed",
        toStatus: "broadcast",
        updatedAt: this.#readTransactionTimestamp(),
        patch: {
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        },
      });
      if (!broadcastMeta) {
        return;
      }

      let durable: Awaited<ReturnType<TransactionsService["createSubmitted"]>>;
      try {
        if (!broadcastMeta.from) {
          throw new Error(`Transaction ${broadcastMeta.id} is missing a from address.`);
        }
        durable = await this.#service.createSubmitted({
          id: broadcastMeta.id,
          createdAt: broadcastMeta.createdAt,
          chainRef: broadcastMeta.chainRef,
          origin: broadcastMeta.origin,
          fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
            chainRef: broadcastMeta.chainRef,
            address: broadcastMeta.from,
          }),
          status: "broadcast",
          submitted: structuredClone(broadcast.submitted),
          locator: structuredClone(broadcast.locator),
        });
      } catch (error) {
        const persistenceFailure = error instanceof Error ? error : new Error("Transaction persistence failed");
        this.#runtime.transition({
          id,
          fromStatus: "broadcast",
          toStatus: "failed",
          updatedAt: this.#readTransactionTimestamp(),
          patch: {
            error: coerceTransactionError(persistenceFailure) ?? {
              name: "TransactionPersistenceError",
              message: "Transaction was broadcast but could not be persisted locally.",
            },
          },
        });
        return;
      }

      this.#runtime.markDurablySubmitted(id);
      this.#proposals.deleteReviewSession(id);

      const { previous, next } = this.#view.commitRecord(durable);
      this.#tracking.handleTransition(previous, next);
    } catch (err) {
      if (err && isArxError(err) && err.reason === ArxReasons.SessionLocked) {
        this.#runtime.resetSignedToApproved(id, this.#readTransactionTimestamp());
        return;
      }
      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    }
  }

  async resumePending(): Promise<void> {
    this.#view.requestSync();
    for (const runtimeId of this.#runtime.listExecutableIds()) {
      this.#enqueue(runtimeId);
    }

    const broadcast = await this.#listAllByStatus("broadcast");
    for (const record of broadcast) {
      const meta = this.#view.commitRecord(record).next;
      this.#tracking.resumeBroadcast(meta);
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
