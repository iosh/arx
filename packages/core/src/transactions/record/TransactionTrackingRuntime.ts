import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { ReceiptResolution, ReplacementResolution, TransactionReplacementKey } from "../namespace/types.js";
import { isTransactionRecordTerminal } from "../status.js";
import type { ReceiptTracker } from "../tracker/ReceiptTracker.js";
import { createReceiptTracker } from "../tracker/ReceiptTracker.js";
import type { TransactionError } from "../types.js";
import { buildTrackingContext, coerceTransactionError, isUserRejectedError } from "../utils.js";
import type { TransactionRecordStatus, TransactionRecordView } from "./index.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";

type TransactionTrackingRuntimeDeps = {
  recordView: TransactionRecordViewStore;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  tracker?: ReceiptTracker;
};

const toDurableReplacementKey = (
  replacementKey: TransactionReplacementKey | null,
): NonNullable<TransactionRecord["replacementKey"]> | null => {
  if (!replacementKey) return null;
  return {
    scope: replacementKey.scope,
    value: replacementKey.value,
  };
};

export class TransactionTrackingRuntime {
  #recordView: TransactionRecordViewStore;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #service: TransactionsService;
  #tracker: ReceiptTracker;

  constructor(deps: TransactionTrackingRuntimeDeps) {
    this.#recordView = deps.recordView;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#tracker =
      deps.tracker ??
      createReceiptTracker({
        getTransaction: (namespace: string) => this.#namespaces.get(namespace),
        onReceipt: async (id, resolution) => {
          await this.#applyReceiptResolution(id, resolution);
        },
        onReplacement: async (id, resolution) => {
          await this.#applyReplacementResolution(id, resolution);
        },
        onTimeout: async (id) => {
          await this.#handleTrackingTimeout(id);
        },
        onUnsupported: async (id, error) => {
          await this.#handleTrackingUnsupported(id, error);
        },
      });
  }

  startTracking(record: TransactionRecordView, options?: { resume?: boolean }): void {
    if (record.status !== "broadcast") {
      this.#tracker.stop(record.id);
      return;
    }

    const namespaceTransaction = this.#namespaces.get(record.namespace);
    if (!namespaceTransaction?.tracking) {
      void this.#handleTrackingUnsupported(
        record.id,
        new Error(`Namespace transaction ${record.namespace} cannot fetch receipts.`),
      ).catch(() => {});
      return;
    }

    const context = buildTrackingContext(record);
    if (options?.resume) {
      this.#tracker.resume(record.id, context);
      return;
    }

    if (this.#tracker.isTracking(record.id)) {
      this.#tracker.resume(record.id, context);
      return;
    }

    this.#tracker.start(record.id, context);
  }

  stopTracking(id: string): void {
    this.#tracker.stop(id);
  }

  isTracking(id: string): boolean {
    return this.#tracker.isTracking(id);
  }

  async failRecord(id: string, reason?: Error | TransactionError): Promise<void> {
    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      return;
    }

    const latestView = this.#recordView.commitRecordView(latestRecord).next;
    const error = coerceTransactionError(reason) ?? null;
    const userRejected = isUserRejectedError(reason, error ?? undefined);
    if (latestView.status === "broadcast" && userRejected) {
      return;
    }
    if (isTransactionRecordTerminal(latestView)) {
      return;
    }

    const updated = await this.#service.updateRecordStatus({
      id,
      fromStatus: latestView.status,
      toStatus: "failed",
    });
    if (!updated) {
      return;
    }

    this.#tracker.stop(id);
    this.#recordView.commitRecordView(updated);
  }

  async resumeBroadcastRecords(): Promise<void> {
    this.#recordView.requestSync();
    for (const record of await this.#listAllByStatus("broadcast")) {
      const committed = this.#recordView.commitRecordView(record);
      this.startTracking(committed.next, { resume: true });
    }
  }

  async #applyReceiptResolution(id: string, resolution: ReceiptResolution): Promise<void> {
    const record = await this.#loadBroadcastRecord(id);
    if (!record) return;

    if (resolution.status === "success") {
      const confirmed = await this.#transitionRecord({
        id,
        fromStatus: "broadcast",
        toStatus: "confirmed",
        patch: { receipt: resolution.receipt },
      });
      if (confirmed) {
        await this.#linkConfirmedReplacement(confirmed);
      }
      return;
    }

    await this.#transitionRecord({
      id,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: { receipt: resolution.receipt },
    });
  }

  async #applyReplacementResolution(id: string, resolution: ReplacementResolution): Promise<void> {
    const record = await this.#loadBroadcastRecord(id);
    if (!record) return;

    const view = this.#recordView.getOrLoadView ? await this.#recordView.getOrLoadView(record.id) : null;
    const trackingView = view ?? this.#recordView.commitRecordView(record).next;
    const namespaceTransaction = this.#namespaces.get(trackingView.namespace);
    const trackingContext = buildTrackingContext(trackingView);
    let replacedByRecordId = resolution.replacedByRecordId;
    if (replacedByRecordId === undefined && namespaceTransaction?.tracking?.deriveReplacementKey) {
      const replacementKey = toDurableReplacementKey(
        namespaceTransaction.tracking.deriveReplacementKey(trackingContext),
      );
      if (replacementKey) {
        const confirmedReplacement = await this.#findConfirmedReplacementCandidate({
          replacedRecordId: record.id,
          replacementKey,
        });
        if (confirmedReplacement) {
          replacedByRecordId = confirmedReplacement.id;
        }
      }
    }

    await this.#transitionRecord({
      id,
      fromStatus: "broadcast",
      toStatus: "replaced",
      patch: {
        ...(replacedByRecordId !== undefined ? { replacedByRecordId } : {}),
      },
    });
  }

  async #handleTrackingTimeout(id: string): Promise<void> {
    const record = await this.#loadBroadcastRecord(id);
    if (!record) return;
    this.#tracker.stop(id);
  }

  async #handleTrackingUnsupported(id: string, _error: unknown): Promise<void> {
    const record = await this.#loadBroadcastRecord(id);
    if (!record) return;
    this.#tracker.stop(id);
  }

  async #transitionRecord(params: {
    id: string;
    fromStatus: TransactionRecordStatus;
    toStatus: TransactionRecordStatus;
    patch: NonNullable<Parameters<TransactionsService["updateRecordStatus"]>[0]["patch"]>;
  }): Promise<TransactionRecord | null> {
    const updated = await this.#service.updateRecordStatus({
      id: params.id,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      patch: params.patch,
    });
    if (!updated) return null;

    this.#recordView.commitRecordView(updated);
    if (updated.status !== "broadcast") {
      this.#tracker.stop(updated.id);
    }
    return updated;
  }

  async #linkConfirmedReplacement(confirmed: TransactionRecord): Promise<void> {
    const replacementKey = confirmed.replacementKey;
    if (!replacementKey) return;

    for (const candidate of await this.#service.findByReplacementKey(replacementKey)) {
      if (candidate.id === confirmed.id) continue;
      if (candidate.status === "broadcast") {
        await this.#transitionRecord({
          id: candidate.id,
          fromStatus: "broadcast",
          toStatus: "replaced",
          patch: { replacedByRecordId: confirmed.id },
        });
        continue;
      }
      if (candidate.status !== "replaced" || candidate.replacedByRecordId) continue;

      const patched = await this.#service.linkRecord({
        id: candidate.id,
        expectedStatus: "replaced",
        patch: { replacedByRecordId: confirmed.id },
      });
      if (patched) {
        this.#recordView.commitRecordView(patched);
      }
    }
  }

  async #findConfirmedReplacementCandidate(params: {
    replacedRecordId: string;
    replacementKey: NonNullable<TransactionRecord["replacementKey"]>;
  }) {
    const candidates = await this.#service.findByReplacementKey(params.replacementKey);
    for (const record of candidates) {
      if (record.id === params.replacedRecordId || record.status !== "confirmed") continue;
      return record;
    }

    return null;
  }

  async #loadBroadcastRecord(id: string): Promise<TransactionRecord | null> {
    const record = await this.#service.get(id);
    if (!record || record.status !== "broadcast") {
      return null;
    }
    return record;
  }

  async #listAllByStatus(status: TransactionRecordStatus) {
    const out = [];
    let cursor: ListTransactionsCursor | undefined;

    while (true) {
      const page = await this.#service.list({
        status,
        limit: 200,
        ...(cursor !== undefined ? { before: cursor } : {}),
      });
      if (page.length === 0) {
        break;
      }

      out.push(...page);
      const tail = page.at(-1);
      cursor = tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
      if (cursor === undefined) {
        break;
      }
    }

    return out;
  }
}
