import { persistenceChange } from "../persistence/change.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { type SubmittedTransactionRecord, type TransactionRecord, transactionPersistenceType } from "./persistence.js";
import {
  getTransactionNamespaceAdapter,
  type TransactionInspection,
  type TransactionNamespaceAdapters,
} from "./transactionNamespace.js";
import {
  confirmTransaction,
  dropTransaction,
  expireTransaction,
  failSubmittedTransaction,
  replaceTransaction,
} from "./transactionRecord.js";

type MonitorEntry = {
  transactionId: string;
  attempt: number;
  nextInspectionAt: number;
};

/** Tracks submitted transaction IDs and reloads each canonical record before inspection. */
export class TransactionMonitor {
  readonly #readers: Pick<CorePersistenceReaders, "transactions">;
  readonly #mutations: CoreMutationQueue;
  readonly #adapters: TransactionNamespaceAdapters;
  readonly #publishChanged: (transactionIds: readonly string[]) => void;
  readonly #entries = new Map<string, MonitorEntry>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #running: Promise<void> | null = null;

  constructor(params: {
    readers: Pick<CorePersistenceReaders, "transactions">;
    mutations: CoreMutationQueue;
    adapters: TransactionNamespaceAdapters;
    publishChanged(transactionIds: readonly string[]): void;
  }) {
    this.#readers = params.readers;
    this.#mutations = params.mutations;
    this.#adapters = params.adapters;
    this.#publishChanged = params.publishChanged;
  }

  restore(records: readonly SubmittedTransactionRecord[]): void {
    const now = Date.now();
    for (const record of records) this.#track(record, now);
    this.#schedule();
  }

  track(record: SubmittedTransactionRecord): void {
    this.#track(record, Date.now());
    this.#schedule();
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule();
  }

  stop(): void {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  getNextInspectionAt(): number | null {
    let next: number | null = null;
    for (const entry of this.#entries.values()) {
      if (next === null || entry.nextInspectionAt < next) next = entry.nextInspectionAt;
    }
    return next;
  }

  runDue(now = Date.now()): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#runDue(now).finally(() => {
      this.#running = null;
      this.#schedule();
    });
    return this.#running;
  }

  #track(record: SubmittedTransactionRecord, now: number): void {
    const adapter = getTransactionNamespaceAdapter(this.#adapters, record.chainRef);
    this.#entries.set(record.transactionId, {
      transactionId: record.transactionId,
      attempt: 0,
      nextInspectionAt: now + adapter.getInitialInspectionDelay(record),
    });
  }

  async #runDue(now: number): Promise<void> {
    const due = [...this.#entries.values()].filter((entry) => entry.nextInspectionAt <= now);
    for (const entry of due) await this.#inspect(entry, now);
  }

  async #inspect(entry: MonitorEntry, now: number): Promise<void> {
    const record = await this.#readers.transactions.get(entry.transactionId);
    if (record?.status !== "submitted") {
      this.#entries.delete(entry.transactionId);
      return;
    }
    const adapter = getTransactionNamespaceAdapter(this.#adapters, record.chainRef);
    const attempt = entry.attempt + 1;
    let inspection: TransactionInspection;
    try {
      inspection = await adapter.inspect(record);
    } catch (error) {
      this.#entries.set(record.transactionId, {
        transactionId: record.transactionId,
        attempt,
        nextInspectionAt: now + adapter.getRetryInspectionDelay({ record, attempt, error }),
      });
      return;
    }

    if (inspection.status === "pending") {
      this.#entries.set(record.transactionId, {
        transactionId: record.transactionId,
        attempt,
        nextInspectionAt: now + adapter.getPendingInspectionDelay({ record, attempt }),
      });
      return;
    }

    const changedTransactionIds = await this.#commitInspection(record.transactionId, inspection);
    for (const transactionId of changedTransactionIds) this.#entries.delete(transactionId);
  }

  async #commitInspection(
    transactionId: string,
    inspection: Exclude<TransactionInspection, { status: "pending" }>,
  ): Promise<readonly string[]> {
    return await this.#mutations.run(async (commit) => {
      const current = await this.#readers.transactions.get(transactionId);
      if (current?.status !== "submitted") return [];
      const changes: TransactionRecord[] = [];
      if (inspection.status === "confirmed") {
        changes.push(confirmTransaction(current, inspection.confirmation));
        if (current.conflictKey) {
          const conflicts = await this.#readers.transactions.listByConflictKey({
            chainRef: current.chainRef,
            conflictKey: current.conflictKey,
          });
          changes.push(
            ...conflicts
              .filter((candidate) => candidate.transactionId !== transactionId && candidate.status === "submitted")
              .map((candidate) => replaceTransaction(candidate, transactionId)),
          );
        }
      } else if (inspection.status === "failed") {
        changes.push(
          failSubmittedTransaction(current, {
            reason: inspection.reason,
            ...(inspection.evidence ? { evidence: inspection.evidence } : {}),
          }),
        );
      } else if (inspection.status === "dropped") {
        changes.push(dropTransaction(current, inspection.evidence));
      } else {
        changes.push(expireTransaction(current, inspection.evidence));
      }
      await commit(changes.map((record) => persistenceChange.put(transactionPersistenceType, record)));
      const transactionIds = changes.map((record) => record.transactionId);
      this.#publishChanged(transactionIds);
      return transactionIds;
    });
  }

  #schedule(): void {
    if (!this.#started || this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const next = this.getNextInspectionAt();
    if (next === null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        void this.runDue();
      },
      Math.max(0, next - Date.now()),
    );
  }
}
