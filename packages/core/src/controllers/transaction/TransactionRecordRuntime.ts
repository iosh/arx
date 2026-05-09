import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord, TransactionReplacementIdentity } from "../../storage/records.js";
import { TransactionSubmittedSchema } from "../../storage/schemas.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { ReceiptResolution, ReplacementResolution } from "../../transactions/namespace/types.js";
import type { ReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import { createReceiptTracker } from "../../transactions/tracker/ReceiptTracker.js";
import type { TransactionError, TransactionSubmitted } from "../../transactions/types.js";
import { isTransactionRecordTerminal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { TransactionProposalMeta, TransactionRecordStatus, TransactionRecordView } from "./types.js";
import {
  buildTrackingContext,
  coerceTransactionError,
  createTransactionPersistenceError,
  encodeReplacementKey,
  isUserRejectedError,
} from "./utils.js";

type TransactionRecordRuntimeDeps = {
  proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  submission: Pick<TransactionSubmissionStore, "recordPersistenceFailure">;
  tracker?: ReceiptTracker;
};

const parseDurableSubmitted = (params: {
  submitted: TransactionSubmitted;
  namespaceTransaction: ReturnType<NamespaceTransactions["get"]>;
}): TransactionRecord["submitted"] => {
  const parsedSubmitted = params.namespaceTransaction?.record?.parseSubmitted(structuredClone(params.submitted));
  return TransactionSubmittedSchema.parse(parsedSubmitted ?? params.submitted);
};

const toStoredReplacementIdentity = (
  replacementKey: import("../../transactions/namespace/types.js").TransactionReplacementKey | null,
): TransactionReplacementIdentity => {
  if (!replacementKey) return null;
  return {
    scope: replacementKey.scope,
    value: replacementKey.value,
  };
};

export class TransactionRecordRuntime {
  #proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #service: TransactionsService;
  #submission: Pick<TransactionSubmissionStore, "recordPersistenceFailure">;
  #tracker: ReceiptTracker;

  constructor(deps: TransactionRecordRuntimeDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#submission = deps.submission;
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

  async persistBroadcastRecord(meta: TransactionProposalMeta, submitted: TransactionSubmitted): Promise<void> {
    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    const durableSubmitted = parseDurableSubmitted({
      submitted,
      namespaceTransaction,
    });

    try {
      if (!meta.from) {
        throw new Error(`Transaction ${meta.id} is missing a from address.`);
      }

      const replacementIdentity = this.#deriveReplacementIdentity({
        namespace: meta.namespace,
        chainRef: meta.chainRef,
        origin: meta.origin,
        from: meta.from,
        id: meta.id,
        submitted: durableSubmitted,
      });

      const durable = await this.#service.createSubmitted({
        id: meta.id,
        createdAt: meta.createdAt,
        chainRef: meta.chainRef,
        origin: meta.origin,
        fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
          chainRef: meta.chainRef,
          address: meta.from,
        }),
        status: "broadcast",
        submitted: structuredClone(durableSubmitted),
        replacementIdentity,
      });

      this.#proposalStore.clearProposalAfterRecordPersisted(meta.id);
      const committed = this.#recordView.commitRecordView(durable);
      this.#startTrackingView(committed.next);
    } catch (error) {
      const persistenceFailure = error instanceof Error ? error : new Error("Transaction persistence failed");
      this.#submission.recordPersistenceFailure(meta.id, {
        transactionId: meta.id,
        error: createTransactionPersistenceError({
          cause: persistenceFailure,
          transactionId: meta.id,
          submitted,
        }),
        submitted: structuredClone(submitted),
      });
      this.#proposalStore.delete(meta.id);
    }
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

    const updated = await this.#service.transition({
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
      this.#startTrackingView(committed.next, { resume: true });
    }
  }

  async listRecordsByStatus(status: TransactionRecordStatus): Promise<TransactionRecordView[]> {
    const out: TransactionRecordView[] = [];
    for (const record of await this.#listAllByStatus(status)) {
      out.push(this.#recordView.commitRecordView(record).next);
    }
    return out;
  }

  stopTracking(id: string): void {
    this.#tracker.stop(id);
  }

  isTracking(id: string): boolean {
    return this.#tracker.isTracking(id);
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
    let replacedId = resolution.replacedId;
    if (replacedId === undefined && namespaceTransaction?.tracking?.deriveReplacementKey) {
      const replacementIdentity = toStoredReplacementIdentity(
        namespaceTransaction.tracking.deriveReplacementKey(trackingContext),
      );
      if (replacementIdentity) {
        const confirmedReplacement = await this.#findConfirmedReplacementCandidate({
          replacedId: record.id,
          replacementIdentity,
        });
        if (confirmedReplacement) {
          replacedId = confirmedReplacement.id;
        }
      }
    }

    await this.#transitionRecord({
      id,
      fromStatus: "broadcast",
      toStatus: "replaced",
      patch: {
        ...(replacedId !== undefined ? { replacedId } : {}),
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

  #startTrackingView(record: TransactionRecordView, options?: { resume?: boolean }): void {
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

  async #transitionRecord(params: {
    id: string;
    fromStatus: TransactionRecordStatus;
    toStatus: TransactionRecordStatus;
    patch: NonNullable<Parameters<TransactionsService["transition"]>[0]["patch"]>;
  }): Promise<TransactionRecord | null> {
    const updated = await this.#service.transition({
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
    const replacementIdentity = confirmed.replacementIdentity ?? null;
    if (!replacementIdentity) return;

    for (const candidate of await this.#service.findByReplacementIdentity(replacementIdentity)) {
      if (candidate.id === confirmed.id) continue;
      if (candidate.status === "broadcast") {
        await this.#transitionRecord({
          id: candidate.id,
          fromStatus: "broadcast",
          toStatus: "replaced",
          patch: { replacedId: confirmed.id },
        });
        continue;
      }
      if (candidate.status !== "replaced" || candidate.replacedId) continue;

      const patched = await this.#service.patchIfStatus({
        id: candidate.id,
        expectedStatus: "replaced",
        patch: { replacedId: confirmed.id },
      });
      if (patched) {
        this.#recordView.commitRecordView(patched);
      }
    }
  }

  async #findConfirmedReplacementCandidate(params: {
    replacedId: string;
    replacementIdentity: NonNullable<TransactionRecord["replacementIdentity"]>;
  }) {
    const candidates = await this.#service.findByReplacementIdentity(params.replacementIdentity);
    for (const record of candidates) {
      if (record.id === params.replacedId || record.status !== "confirmed") continue;
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

  #deriveReplacementIdentity(input: {
    namespace: string;
    chainRef: string;
    origin: string;
    from: string;
    id: string;
    submitted: TransactionRecord["submitted"];
  }): TransactionReplacementIdentity {
    const namespaceTransaction = this.#namespaces.get(input.namespace);
    if (!namespaceTransaction?.tracking?.deriveReplacementKey) return null;

    const replacementKey = namespaceTransaction.tracking.deriveReplacementKey({
      recordId: input.id,
      namespace: input.namespace,
      chainRef: input.chainRef,
      origin: input.origin,
      from: input.from,
      submitted: structuredClone(input.submitted),
    });
    return toStoredReplacementIdentity(replacementKey);
  }
}
