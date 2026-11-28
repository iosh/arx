import type { ChainRef } from "../networks/chainRef.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { pendingTransactionHash } from "./eip155/transactionHash.js";
import type { TerminalTransactionChange, TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
import { type PendingTransactionRecord, type TransactionRecord, transactionWrites } from "./persistence.js";
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

export class TransactionMonitor {
  readonly #adapters: TransactionsNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #time: CoreTime;
  readonly #publishChanged: (change: TransactionsChanged) => void;
  readonly #pending = new Map<TransactionId, MonitoredTransaction>();
  readonly #inspectingChains = new Set<ChainRef>();

  #cancelTimer: (() => void) | undefined;

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

    this.#cancelScheduledInspection();
    this.#schedule(0);
  }

  track(record: PendingTransactionRecord): void {
    this.#pending.set(record.transactionId, { record, needsRecovery: false });
    this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
  }

  stop(transactionId: TransactionId): void {
    this.#pending.delete(transactionId);
    if (this.#pending.size === 0) this.#cancelScheduledInspection();
  }

  #schedule(delayMs: number): void {
    if (this.#pending.size === 0 || this.#cancelTimer) return;

    this.#cancelTimer = this.#time.schedule(delayMs, () => {
      this.#cancelTimer = undefined;
      this.#inspectPendingChains();
      this.#schedule(TRANSACTION_INSPECTION_INTERVAL_MS);
    });
  }

  #cancelScheduledInspection(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
  }

  #inspectPendingChains(): void {
    const recordsByChainRef = new Map<ChainRef, [MonitoredTransaction, ...MonitoredTransaction[]]>();
    for (const monitored of this.#pending.values()) {
      const { chainRef } = monitored.record;
      if (this.#inspectingChains.has(chainRef)) continue;

      const records = recordsByChainRef.get(chainRef);
      if (records) records.push(monitored);
      else recordsByChainRef.set(chainRef, [monitored]);
    }

    for (const [chainRef, records] of recordsByChainRef) {
      void this.#inspectChain(chainRef, records);
    }
  }

  async #inspectChain(
    chainRef: ChainRef,
    monitoredRecords: readonly [MonitoredTransaction, ...MonitoredTransaction[]],
  ): Promise<void> {
    this.#inspectingChains.add(chainRef);
    try {
      const records = monitoredRecords.map(({ record }) => record);
      const recoveryTransactionIds = monitoredRecords
        .filter(({ needsRecovery }) => needsRecovery)
        .map(({ record }) => record.transactionId);
      const adapter = this.#adapters[monitoredRecords[0].record.namespace];
      const inspection =
        recoveryTransactionIds.length === 0
          ? await adapter.inspectPending(records)
          : await adapter.recoverPending(records, recoveryTransactionIds);

      if (inspection.status === "unavailable") return;

      if (inspection.terminalChanges.length > 0) {
        const committed = await this.#commitTerminalChanges(chainRef, monitoredRecords, inspection.terminalChanges);
        if (!committed) return;
      }

      for (const monitored of monitoredRecords) {
        if (!monitored.needsRecovery) continue;
        if (this.#pending.get(monitored.record.transactionId) === monitored) monitored.needsRecovery = false;
      }
    } catch (error) {
      console.error("[arx:transactions] Failed to inspect pending transactions", chainRef, error);
    } finally {
      this.#inspectingChains.delete(chainRef);
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
        const monitored = monitoredById.get(change.transactionId) as MonitoredTransaction;

        const { recovery: _recovery, ...transaction } = monitored.record;
        terminalRecords.push({
          ...transaction,
          hash: pendingTransactionHash(monitored.record),
          state: change.state,
          updatedAt: now,
        });
      }
      await commit(terminalRecords.map(transactionWrites.put));

      for (const record of terminalRecords) {
        const monitored = monitoredById.get(record.transactionId) as MonitoredTransaction;
        if (this.#pending.get(record.transactionId) === monitored) {
          this.stop(record.transactionId);
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
