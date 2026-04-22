import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ReceiptResolution, ReplacementResolution } from "../../transactions/adapters/types.js";
import { createReceiptTracker, type ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isTerminalTransactionStatus } from "./status.js";
import type { TransactionMeta } from "./types.js";
import { buildTrackingContext } from "./utils.js";

type Options = {
  view: StoreTransactionView;
  registry: TransactionAdapterRegistry;
  service: TransactionsService;
  tracker?: ReceiptTracker;
};

export class TransactionReceiptTracking {
  #view: StoreTransactionView;
  #registry: TransactionAdapterRegistry;
  #service: TransactionsService;
  #tracker: ReceiptTracker;

  constructor({ view, registry, service, tracker }: Options) {
    this.#view = view;
    this.#registry = registry;
    this.#service = service;

    const trackerDeps = {
      getAdapter: (namespace: string) => this.#registry.get(namespace),
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
      const adapter = this.#registry.get(next.namespace);
      if (!adapter?.receiptTracking) {
        void this.#handleTrackingUnsupported(
          next.id,
          new Error(`Adapter ${next.namespace} cannot fetch receipts.`),
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
    const adapter = this.#registry.get(meta.namespace);
    if (!adapter?.receiptTracking) {
      void this.#handleTrackingUnsupported(
        meta.id,
        new Error(`Adapter ${meta.namespace} cannot fetch receipts.`),
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
      await this.#transitionAndCommit({
        id,
        fromStatus: "broadcast",
        toStatus: "confirmed",
        patch: { receipt: resolution.receipt },
      });
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

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "replaced",
      patch: {
        ...(resolution.replacementTransactionId !== undefined ? { replacedById: resolution.replacementTransactionId } : {}),
      },
    });
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
  }) {
    const updated = await this.#service.transition({
      id: params.id,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      patch: params.patch,
    });
    if (!updated) return;
    const { previous, next } = this.#view.commitRecord(updated);
    this.handleTransition(previous, next);
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
