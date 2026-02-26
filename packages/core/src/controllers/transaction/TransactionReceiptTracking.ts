import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { ReceiptResolution, ReplacementResolution } from "../../transactions/adapters/types.js";
import { createReceiptTracker, type ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { StoreTransactionView } from "./StoreTransactionView.js";
import { isTerminalTransactionStatus } from "./status.js";
import type { TransactionMeta } from "./types.js";
import { buildAdapterContext } from "./utils.js";

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
      onError: async (id: string, error: unknown) => {
        await this.#handleTrackerError(id, error);
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
    if (next.status === "broadcast" && typeof next.hash === "string") {
      const context = buildAdapterContext(next);
      if (this.#tracker.isTracking(next.id)) {
        this.#tracker.resume(next.id, context, next.hash);
      } else {
        this.#tracker.start(next.id, context, next.hash);
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
    if (meta.status !== "broadcast" || typeof meta.hash !== "string") return;
    this.#tracker.resume(meta.id, buildAdapterContext(meta), meta.hash);
  }

  async #applyReceiptResolution(id: string, resolution: ReceiptResolution): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    if (resolution.status === "success") {
      await this.#transitionAndCommit({
        id,
        fromStatus: "broadcast",
        toStatus: "confirmed",
        patch: { receipt: resolution.receipt, error: undefined, userRejected: false },
      });
      return;
    }

    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {
        receipt: resolution.receipt,
        error: {
          name: "TransactionExecutionFailed",
          message: "Transaction execution failed.",
          data: resolution.receipt,
        },
        userRejected: false,
      },
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
        hash: resolution.hash ?? meta.hash,
        error: {
          name: "TransactionReplacedError",
          message: "Transaction was replaced by another transaction with the same nonce.",
          data: { replacementHash: resolution.hash },
        },
        userRejected: false,
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
      patch: {
        error: {
          name: "TransactionReceiptTimeoutError",
          message: "Timed out waiting for transaction receipt.",
        },
        userRejected: false,
      },
    });
  }

  async #handleTrackerError(id: string, error: unknown): Promise<void> {
    const meta = await this.#loadBroadcastMeta(id);
    if (!meta) return;

    const message = error instanceof Error ? error.message : String(error);
    await this.#transitionAndCommit({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: {
        error: {
          name: "ReceiptTrackingError",
          message,
          data: error instanceof Error ? { name: error.name } : undefined,
        },
        userRejected: false,
      },
    });
  }

  async #transitionAndCommit(params: {
    id: string;
    fromStatus: TransactionMeta["status"];
    toStatus: TransactionMeta["status"];
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
