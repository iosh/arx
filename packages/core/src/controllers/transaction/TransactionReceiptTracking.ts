import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptResolution, ReplacementResolution } from "../../transactions/namespace/types.js";
import { createReceiptTracker, type ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isTerminalTransactionStatus } from "./status.js";
import type { TransactionMeta } from "./types.js";
import { buildTrackingContext, encodeReplacementKey } from "./utils.js";

type Options = {
  view: StoreTransactionView;
  namespaces: NamespaceTransactions;
  service: TransactionsService;
  tracker?: ReceiptTracker;
};

export class TransactionReceiptTracking {
  #view: StoreTransactionView;
  #namespaces: NamespaceTransactions;
  #service: TransactionsService;
  #tracker: ReceiptTracker;

  constructor({ view, namespaces, service, tracker }: Options) {
    this.#view = view;
    this.#namespaces = namespaces;
    this.#service = service;

    const trackerDeps = {
      getTransaction: (namespace: string) => this.#namespaces.get(namespace),
      onReceipt: async (id: string, resolution: ReceiptResolution) => {
        await this.#applyReceiptResolution(id, resolution);
      },
      onReplacement: async (id: string, resolution: ReplacementResolution) => {
        await this.#applyReplacementResolution(id, resolution);
      },
      onTimeout: async (id: string) => {
        await this.#handleTrackerTimeout(id);
      },
      onUnsupported: async (id: string, error: unknown) => {
        await this.#handleTrackingUnsupported(id, error);
      },
    };

    this.#tracker = tracker ?? createReceiptTracker(trackerDeps);
  }

  stop(id: string) {
    this.#tracker.stop(id);
  }

  isTracking(id: string) {
    return this.#tracker.isTracking(id);
  }

  /**
   * Called after state transitions. Starts/stops receipt polling as needed.
   */
  handleTransition(previous: TransactionMeta | undefined, next: TransactionMeta) {
    if (next.status === "broadcast" && next.submitted && next.locator) {
      const namespaceTransaction = this.#namespaces.get(next.namespace);
      if (!namespaceTransaction?.receiptTracking) {
        void this.#handleTrackingUnsupported(
          next.id,
          new Error(`Namespace transaction ${next.namespace} cannot fetch receipts.`),
        ).catch(() => {});
        return;
      }

      const context = buildTrackingContext(next);
      if (!context) {
        return;
      }
      if (this.#tracker.isTracking(next.id)) {
        this.#tracker.resume(next.id, context);
      } else {
        this.#tracker.start(next.id, context);
      }
      return;
    }

    if (previous?.status === "broadcast" && next.status !== "broadcast") {
      this.#tracker.stop(next.id);
      return;
    }

    if (isTerminalTransactionStatus(next.status)) {
      this.#tracker.stop(next.id);
    }
  }

  /**
   * Used on cold start recovery to resume polling from persisted broadcast txs.
   */
  resumeBroadcast(meta: TransactionMeta) {
    if (meta.status !== "broadcast" || !meta.submitted || !meta.locator) return;
    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction?.receiptTracking) {
      void this.#handleTrackingUnsupported(
        meta.id,
        new Error(`Namespace transaction ${meta.namespace} cannot fetch receipts.`),
      ).catch(() => {});
      return;
    }
    const context = buildTrackingContext(meta);
    if (!context) return;
    this.#tracker.resume(meta.id, context);
  }

  async #applyReceiptResolution(id: string, resolution: ReceiptResolution): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    if (resolution.status === "success") {
      const committed = await this.#transitionAndCommit({
        id,
        fromStatus: "broadcast",
        toStatus: "confirmed",
        patch: { receipt: resolution.receipt },
      });
      if (committed) {
        await this.#linkConfirmedReplacement(committed.next);
      }
      return;
    }

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: { receipt: resolution.receipt },
    });
  }

  async #applyReplacementResolution(id: string, resolution: ReplacementResolution): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    const trackingContext = buildTrackingContext(meta);
    let replacedId = resolution.replacedId;
    if (replacedId === undefined && namespaceTransaction?.deriveReplacementKey && trackingContext) {
      const key = namespaceTransaction.deriveReplacementKey(trackingContext);
      if (key) {
        const replacementKey = encodeReplacementKey(key);
        const replacement = await this.#findConfirmedReplacementCandidate({
          replacedId: meta.id,
          replacementKey,
        });
        if (replacement) {
          replacedId = replacement.id;
        }
      }
    }

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "replaced",
      patch: {
        ...(replacedId !== undefined ? { replacedId } : {}),
      },
    });
  }

  async #linkConfirmedReplacement(confirmed: TransactionMeta): Promise<void> {
    const replacementKey = this.#deriveReplacementKey(confirmed);
    if (!replacementKey) return;

    for (const candidate of await this.#listAllByStatus("broadcast")) {
      if (candidate.id === confirmed.id) continue;
      if (this.#deriveReplacementKeyFromRecord(candidate) !== replacementKey) continue;

      await this.#transitionAndCommit({
        id: candidate.id,
        fromStatus: "broadcast",
        toStatus: "replaced",
        patch: { replacedId: confirmed.id },
      });
    }

    for (const candidate of await this.#listAllByStatus("replaced")) {
      if (candidate.id === confirmed.id || candidate.replacedId) continue;
      if (this.#deriveReplacementKeyFromRecord(candidate) !== replacementKey) continue;

      const patched = await this.#service.patchIfStatus({
        id: candidate.id,
        expectedStatus: "replaced",
        patch: { replacedId: confirmed.id },
      });
      if (patched) {
        this.#view.commitRecord(patched);
      }
    }
  }

  async #findConfirmedReplacementCandidate(params: { replacedId: string; replacementKey: string }) {
    const records = await this.#listAllByStatus("confirmed");
    for (const record of records) {
      if (record.id === params.replacedId) continue;
      if (this.#deriveReplacementKeyFromRecord(record) === params.replacementKey) {
        return record;
      }
    }

    return null;
  }

  async #listAllByStatus(status: "broadcast" | "confirmed" | "failed" | "replaced") {
    const out = [];
    let cursor: { createdAt: number; id: string } | undefined;

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

  #deriveReplacementKeyFromRecord(record: TransactionRecord): string | null {
    const meta = this.#view.peek(record.id) ?? this.#view.commitRecord(record).next;
    return this.#deriveReplacementKey(meta);
  }

  #deriveReplacementKey(meta: TransactionMeta): string | null {
    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    const trackingContext = buildTrackingContext(meta);
    if (!namespaceTransaction?.deriveReplacementKey || !trackingContext) return null;
    const key = namespaceTransaction.deriveReplacementKey(trackingContext);
    return key ? encodeReplacementKey(key) : null;
  }

  async #handleTrackerTimeout(id: string): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {},
    });
  }

  async #handleTrackingUnsupported(id: string, error: unknown): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {},
    });
  }

  async #transitionAndCommit(params: {
    id: string;
    fromStatus: "broadcast" | "confirmed" | "failed" | "replaced";
    toStatus: "broadcast" | "confirmed" | "failed" | "replaced";
    patch: NonNullable<Parameters<TransactionsService["transition"]>[0]["patch"]>;
  }): Promise<{ previous?: TransactionMeta; next: TransactionMeta } | null> {
    const updated = await this.#service.transition({
      id: params.id,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      patch: params.patch,
    });
    if (!updated) return null;
    const committed = this.#view.commitRecord(updated);
    const { previous, next } = committed;
    this.handleTransition(previous, next);
    return committed;
  }

  async #loadBroadcastMeta(id: string): Promise<TransactionMeta | null> {
    const cached = this.#view.peek(id);
    if (cached) {
      return cached.status === "broadcast" ? cached : null;
    }

    const record = await this.#service.get(id);
    if (!record) return null;
    const meta = this.#view.commitRecord(record).next;
    return meta.status === "broadcast" ? meta : null;
  }
}
