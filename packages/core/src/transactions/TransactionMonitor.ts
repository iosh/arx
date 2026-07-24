import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { getTransactionsNamespaceAdapter, type TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
import { type PendingTransactionRecord, type TransactionRecord, transactionPersistenceType } from "./persistence.js";
import type { TransactionsChanged } from "./Transactions.js";
import type { TerminalTransactionState, TransactionId } from "./types.js";

export const TRANSACTION_INSPECTION_INTERVAL_MS = 15_000;

type MonitoredTransaction = {
  readonly record: PendingTransactionRecord;
  needsRecovery: boolean;
  cancelInspection(): void;
};

export type TransactionMonitorOptions = Readonly<{
  adapters: TransactionsNamespaceAdapters;
  mutations: CoreMutationQueue;
  time: CoreTime;
  publishChanged(change: TransactionsChanged): void;
}>;

export class TransactionMonitor {
  readonly #adapters: TransactionsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #time: CoreTime;
  readonly #publishChanged: (change: TransactionsChanged) => void;
  readonly #pending = new Map<TransactionId, MonitoredTransaction>();

  constructor(options: TransactionMonitorOptions) {
    this.#adapters = options.adapters;
    this.#mutations = options.mutations;
    this.#time = options.time;
    this.#publishChanged = options.publishChanged;
  }

  restore(records: readonly PendingTransactionRecord[]): void {
    for (const record of records) {
      const monitored = this.#add(record, true);
      this.#schedule(monitored, 0);
    }
  }

  track(record: PendingTransactionRecord): () => void {
    const monitored = this.#add(record, false);
    let started = false;

    return () => {
      if (started || this.#pending.get(record.transactionId) !== monitored) return;

      started = true;
      this.#schedule(monitored, TRANSACTION_INSPECTION_INTERVAL_MS);
    };
  }

  stop(transactionId: TransactionId): void {
    const monitored = this.#pending.get(transactionId);
    if (!monitored) return;

    this.#pending.delete(transactionId);
    monitored.cancelInspection();
  }

  stopAll(): void {
    for (const monitored of this.#pending.values()) {
      monitored.cancelInspection();
    }
    this.#pending.clear();
  }

  #add(record: PendingTransactionRecord, needsRecovery: boolean): MonitoredTransaction {
    this.stop(record.transactionId);

    const monitored: MonitoredTransaction = {
      record,
      needsRecovery,
      cancelInspection: () => {},
    };
    this.#pending.set(record.transactionId, monitored);
    return monitored;
  }

  #schedule(monitored: MonitoredTransaction, delayMs: number): void {
    monitored.cancelInspection();
    monitored.cancelInspection = this.#time.schedule(delayMs, () => {
      if (this.#pending.get(monitored.record.transactionId) !== monitored) return;

      monitored.cancelInspection = () => {};
      void this.#inspect(monitored).catch(() => {
        if (this.#pending.get(monitored.record.transactionId) !== monitored) return;

        // The persisted pending record remains available for recovery after a runtime restart.
        this.#pending.delete(monitored.record.transactionId);
        monitored.cancelInspection();
      });
    });
  }

  async #inspect(monitored: MonitoredTransaction): Promise<void> {
    const adapter = getTransactionsNamespaceAdapter(this.#adapters, monitored.record.namespace);
    const inspection = monitored.needsRecovery
      ? await adapter.recoverPending(monitored.record)
      : await adapter.inspectPending(monitored.record);

    if (this.#pending.get(monitored.record.transactionId) !== monitored) return;

    if (inspection.status === "unavailable") {
      this.#schedule(monitored, TRANSACTION_INSPECTION_INTERVAL_MS);
      return;
    }

    if (inspection.status === "pending") {
      monitored.needsRecovery = false;
      this.#schedule(monitored, TRANSACTION_INSPECTION_INTERVAL_MS);
      return;
    }

    await this.#commitTerminalState(monitored, inspection.state);
  }

  async #commitTerminalState(monitored: MonitoredTransaction, state: TerminalTransactionState): Promise<void> {
    await this.#mutations.run(async (commit) => {
      if (this.#pending.get(monitored.record.transactionId) !== monitored) return;

      const { recovery: _recovery, ...transaction } = monitored.record;
      const terminal: TransactionRecord = {
        ...transaction,
        state,
        updatedAt: this.#time.now(),
      };

      await commit([persistenceChange.put(transactionPersistenceType, terminal)]);

      this.#pending.delete(terminal.transactionId);
      monitored.cancelInspection();
      this.#publishChanged({ type: "transactionsChanged", transactionIds: [terminal.transactionId] });
    });
  }
}
