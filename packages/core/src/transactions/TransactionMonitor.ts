import type { ChainRef } from "../networks/chainRef.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import {
  getTransactionsNamespaceAdapter,
  type TerminalTransactionChange,
  type TransactionsNamespaceAdapters,
} from "./namespaceAdapter.js";
import { type PendingTransactionRecord, type TransactionRecord, transactionPersistenceType } from "./persistence.js";
import type { TransactionsChanged } from "./Transactions.js";
import type { TransactionId } from "./types.js";

export const TRANSACTION_INSPECTION_INTERVAL_MS = 15_000;

type MonitoredTransaction = {
  readonly record: PendingTransactionRecord;
  needsRecovery: boolean;
};

export type TransactionMonitorOptions = Readonly<{
  adapters: TransactionsNamespaceAdapters;
  mutations: CoreMutationQueue;
  time: CoreTime;
  publishChanged(change: TransactionsChanged): void;
}>;

const noCancellation = (): void => {};

export class TransactionMonitor {
  readonly #adapters: TransactionsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #time: CoreTime;
  readonly #publishChanged: (change: TransactionsChanged) => void;
  readonly #pending = new Map<TransactionId, MonitoredTransaction>();

  #cancelTimer: () => void = noCancellation;
  #inspectionRunning = false;
  #inspectionScheduled = false;

  constructor(options: TransactionMonitorOptions) {
    this.#adapters = options.adapters;
    this.#mutations = options.mutations;
    this.#time = options.time;
    this.#publishChanged = options.publishChanged;
  }

  restore(records: readonly PendingTransactionRecord[]): void {
    for (const record of records) {
      this.#pending.set(record.transactionId, { record, needsRecovery: true });
    }

    this.#scheduleImmediately();
  }

  track(record: PendingTransactionRecord): void {
    this.#pending.set(record.transactionId, { record, needsRecovery: false });
    this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
  }

  stop(transactionId: TransactionId): void {
    this.#pending.delete(transactionId);
    if (this.#pending.size === 0) this.#cancelScheduledInspection();
  }

  #scheduleImmediately(): void {
    this.#cancelScheduledInspection();
    this.#schedule(0);
  }

  #schedule(delayMs: number): void {
    if (this.#pending.size === 0 || this.#inspectionScheduled) return;

    this.#inspectionScheduled = true;
    this.#cancelTimer = this.#time.schedule(delayMs, () => {
      this.#inspectionScheduled = false;
      this.#cancelTimer = noCancellation;

      if (this.#inspectionRunning) {
        this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
        return;
      }

      void this.#inspect().catch(() => {
        this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
      });
    });
  }

  #cancelScheduledInspection(): void {
    if (!this.#inspectionScheduled) return;

    this.#inspectionScheduled = false;
    this.#cancelTimer();
    this.#cancelTimer = noCancellation;
  }

  async #inspect(): Promise<void> {
    this.#inspectionRunning = true;

    try {
      const recordsByChainRef = new Map<ChainRef, MonitoredTransaction[]>();
      for (const monitored of this.#pending.values()) {
        const records = recordsByChainRef.get(monitored.record.chainRef);
        if (records) records.push(monitored);
        else recordsByChainRef.set(monitored.record.chainRef, [monitored]);
      }

      for (const [chainRef, monitoredRecords] of recordsByChainRef) {
        const records = monitoredRecords.map(({ record }) => record);
        const representativeRecord = records[0];
        if (!representativeRecord) continue;

        const recoveryTransactionIds = monitoredRecords
          .filter(({ needsRecovery }) => needsRecovery)
          .map(({ record }) => record.transactionId);
        const adapter = getTransactionsNamespaceAdapter(this.#adapters, representativeRecord.namespace);
        const inspection =
          recoveryTransactionIds.length === 0
            ? await adapter.inspectPending(records)
            : await adapter.recoverPending(records, recoveryTransactionIds);

        if (inspection.status === "unavailable") continue;

        if (inspection.terminalChanges.length > 0) {
          const committed = await this.#commitTerminalChanges(chainRef, monitoredRecords, inspection.terminalChanges);
          if (!committed) continue;
        }

        for (const monitored of monitoredRecords) {
          if (!monitored.needsRecovery) continue;
          if (this.#pending.get(monitored.record.transactionId) === monitored) monitored.needsRecovery = false;
        }
      }
    } finally {
      this.#inspectionRunning = false;
      this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
    }
  }

  async #commitTerminalChanges(
    chainRef: ChainRef,
    monitoredRecords: readonly MonitoredTransaction[],
    terminalChanges: readonly TerminalTransactionChange[],
  ): Promise<boolean> {
    return await this.#mutations.run(async (commit) => {
      const currentRecords = [...this.#pending.values()].filter((monitored) => monitored.record.chainRef === chainRef);
      if (
        currentRecords.length !== monitoredRecords.length ||
        monitoredRecords.some((monitored) => this.#pending.get(monitored.record.transactionId) !== monitored)
      ) {
        return false;
      }

      const monitoredById = new Map(monitoredRecords.map((monitored) => [monitored.record.transactionId, monitored]));
      const now = this.#time.now();
      const terminalRecords: TransactionRecord[] = [];
      for (const change of terminalChanges) {
        const monitored = monitoredById.get(change.transactionId);
        if (!monitored) return false;

        const { recovery: _recovery, ...transaction } = monitored.record;
        terminalRecords.push({
          ...transaction,
          state: change.state,
          updatedAt: now,
        });
      }
      if (terminalRecords.length === 0) return true;

      await commit(terminalRecords.map((record) => persistenceChange.put(transactionPersistenceType, record)));

      for (const record of terminalRecords) {
        const monitored = monitoredById.get(record.transactionId);
        if (monitored && this.#pending.get(record.transactionId) === monitored) {
          this.#pending.delete(record.transactionId);
        }
      }
      this.#publishChanged({
        type: "transactionsChanged",
        transactionIds: terminalRecords.map((record) => record.transactionId),
      });
      return true;
    });
  }
}
