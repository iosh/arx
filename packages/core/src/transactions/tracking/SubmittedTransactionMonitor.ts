import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import { isArxBaseError } from "../../error.js";
import type { JsonValue, TransactionAggregateStore, TransactionRecord } from "../aggregate/index.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type {
  NamespaceTransactionTracking,
  PendingSubmittedTransactionInspection,
  SubmittedTransactionInspection,
  TransactionFailure,
  TransactionTrackingContext,
} from "../namespace/types.js";
import { buildSubmittedTransactionTrackingContext } from "./contexts.js";
import {
  SubmittedTransactionTrackingCadenceError,
  SubmittedTransactionTrackingInvariantError,
  SubmittedTransactionTrackingUnsupportedError,
} from "./errors.js";
import type { SubmittedTransactionTracker, SubmittedTransactionTrackerResult } from "./SubmittedTransactionTracker.js";

type SubmittedTransactionMonitorDeps = {
  transactions: Pick<TransactionAggregateStore, "loadTransactionAggregate" | "listTransactionHistory">;
  namespaces: Pick<NamespaceTransactions, "require">;
  accountAddressing: AccountAddressingByNamespace;
  tracker: Pick<SubmittedTransactionTracker, "inspectSubmittedTransaction">;
};

type WakeChangedHandler = (nextWakeAt: number | null) => void;

type WatchEntry = {
  transactionId: string;
  scopeKey: string;
  context: TransactionTrackingContext;
  attempt: number;
  nextWakeAt: number;
};

export type SubmittedTransactionMonitorRunResult = {
  checked: number;
  advanced: string[];
  pending: string[];
  retryLater: Array<{
    transactionId: string;
    reason: string;
    nextWakeAt: number;
  }>;
  stale: string[];
  checkFailures: Array<{
    transactionId: string;
    code: string;
    error: unknown;
  }>;
  scopes: Array<{
    key: string;
    checked: number;
    nextWakeAt: number | null;
  }>;
  nextWakeAt: number | null;
};

const toScopeKey = (record: Pick<TransactionRecord, "namespace" | "chainRef">): string =>
  `${record.namespace}:${record.chainRef}`;

const cloneFailureData = (data: JsonValue | null): JsonValue | null => (data === null ? null : structuredClone(data));

const isPendingInspection = (
  inspection: SubmittedTransactionInspection,
): inspection is PendingSubmittedTransactionInspection => inspection.trackingStatus === "pending";

export class SubmittedTransactionMonitor {
  #transactions: Pick<TransactionAggregateStore, "loadTransactionAggregate" | "listTransactionHistory">;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #accountAddressing: AccountAddressingByNamespace;
  #tracker: Pick<SubmittedTransactionTracker, "inspectSubmittedTransaction">;
  #entries = new Map<string, WatchEntry>();
  #wakeChangedHandlers = new Set<WakeChangedHandler>();
  #lastEmittedWakeAt: number | null = null;
  #runDuePromise: Promise<SubmittedTransactionMonitorRunResult> | null = null;
  #dirtyAll = false;
  #dirtyTransactionIds = new Set<string>();

  constructor(deps: SubmittedTransactionMonitorDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountAddressing = deps.accountAddressing;
    this.#tracker = deps.tracker;
  }

  async refresh(input: { now?: number; transactionIds?: readonly string[] } = {}): Promise<void> {
    if (this.#runDuePromise) {
      this.#markDirty(input.transactionIds);
      return;
    }

    await this.#refreshNow(input);
  }

  async #refreshNow(input: { now?: number; transactionIds?: readonly string[] } = {}): Promise<void> {
    const now = input.now ?? Date.now();
    if (input.transactionIds) {
      for (const transactionId of input.transactionIds) {
        await this.#refreshTransaction(transactionId, now);
      }
      this.#emitWakeChangedIfNeeded();
      return;
    }

    const submittedRecords = await this.#transactions.listTransactionHistory({ status: "submitted" });
    const submittedIds = new Set(submittedRecords.map((record) => record.id));
    for (const transactionId of this.#entries.keys()) {
      if (!submittedIds.has(transactionId)) {
        this.#entries.delete(transactionId);
      }
    }
    for (const record of submittedRecords) {
      await this.#refreshTransaction(record.id, now);
    }
    this.#emitWakeChangedIfNeeded();
  }

  runDue(input: { now?: number } = {}): Promise<SubmittedTransactionMonitorRunResult> {
    if (this.#runDuePromise) {
      return this.#runDuePromise;
    }

    this.#runDuePromise = this.#runDueExclusive(input.now ?? Date.now());
    return this.#runDuePromise;
  }

  getNextWakeAt(): number | null {
    let nextWakeAt: number | null = null;
    for (const entry of this.#entries.values()) {
      if (nextWakeAt === null || entry.nextWakeAt < nextWakeAt) {
        nextWakeAt = entry.nextWakeAt;
      }
    }
    return nextWakeAt;
  }

  onWakeChanged(handler: WakeChangedHandler): () => void {
    this.#wakeChangedHandlers.add(handler);
    return () => {
      this.#wakeChangedHandlers.delete(handler);
    };
  }

  async #runDueExclusive(now: number): Promise<SubmittedTransactionMonitorRunResult> {
    try {
      const result = await this.#runDueInternal(now);

      if (this.#dirtyAll || this.#dirtyTransactionIds.size > 0) {
        const transactionIds = this.#dirtyAll ? undefined : Array.from(this.#dirtyTransactionIds);
        this.#dirtyAll = false;
        this.#dirtyTransactionIds.clear();
        await this.#refreshNow({ now, ...(transactionIds ? { transactionIds } : {}) });
      }

      result.nextWakeAt = this.getNextWakeAt();
      this.#emitWakeChangedIfNeeded();
      return result;
    } finally {
      this.#runDuePromise = null;
    }
  }

  async #runDueInternal(now: number): Promise<SubmittedTransactionMonitorRunResult> {
    const dueEntries = Array.from(this.#entries.values()).filter((entry) => entry.nextWakeAt <= now);
    const result: SubmittedTransactionMonitorRunResult = {
      checked: 0,
      advanced: [],
      pending: [],
      retryLater: [],
      stale: [],
      checkFailures: [],
      scopes: [],
      nextWakeAt: this.getNextWakeAt(),
    };
    const scopeChecked = new Map<string, number>();

    for (const entry of dueEntries) {
      result.checked += 1;
      scopeChecked.set(entry.scopeKey, (scopeChecked.get(entry.scopeKey) ?? 0) + 1);

      try {
        const tracking = await this.#tracker.inspectSubmittedTransaction(entry.transactionId);
        this.#applyTrackingResult(entry, tracking, now, result);
      } catch (error) {
        this.#entries.delete(entry.transactionId);
        result.checkFailures.push({
          transactionId: entry.transactionId,
          code: this.#deriveCheckFailureCode(error),
          error,
        });
      }
    }

    result.scopes = Array.from(scopeChecked.keys()).map((key) => ({
      key,
      checked: scopeChecked.get(key) ?? 0,
      nextWakeAt: this.#getScopeNextWakeAt(key),
    }));
    result.nextWakeAt = this.getNextWakeAt();
    return result;
  }

  async #refreshTransaction(transactionId: string, now: number): Promise<void> {
    const aggregate = await this.#transactions.loadTransactionAggregate(transactionId);
    if (!aggregate || aggregate.record.status !== "submitted") {
      this.#entries.delete(transactionId);
      return;
    }

    const existing = this.#entries.get(transactionId);
    const namespaceTracking = this.#getNamespaceTracking(aggregate.record.namespace);
    if (!namespaceTracking) {
      this.#entries.delete(transactionId);
      return;
    }

    const context = buildSubmittedTransactionTrackingContext(aggregate, this.#accountAddressing);
    const nextWakeAt =
      existing?.nextWakeAt ??
      now +
        this.#readInspectionDelay({
          namespace: aggregate.record.namespace,
          operation: "tracking.getInitialInspectionDelay",
          read: () => namespaceTracking.getInitialInspectionDelay(context),
        });

    this.#entries.set(transactionId, {
      transactionId,
      scopeKey: toScopeKey(aggregate.record),
      context,
      attempt: existing?.attempt ?? 0,
      nextWakeAt,
    });
  }

  #applyTrackingResult(
    entry: WatchEntry,
    tracking: SubmittedTransactionTrackerResult,
    now: number,
    result: SubmittedTransactionMonitorRunResult,
  ): void {
    if (tracking.status === "advanced") {
      this.#entries.delete(entry.transactionId);
      result.advanced.push(entry.transactionId);
      return;
    }

    if (tracking.status === "stale") {
      this.#entries.delete(entry.transactionId);
      result.stale.push(entry.transactionId);
      return;
    }

    const namespaceTracking = this.#requireNamespaceTracking(entry.context.namespace);
    const attempt = entry.attempt + 1;

    if (tracking.status === "pending") {
      if (!isPendingInspection(tracking.inspection)) {
        throw new SubmittedTransactionTrackingInvariantError(
          entry.transactionId,
          `Pending tracking result for transaction "${entry.transactionId}" has non-pending inspection.`,
        );
      }
      const pendingInspection = tracking.inspection;

      const delay = this.#readInspectionDelay({
        namespace: entry.context.namespace,
        operation: "tracking.getPendingInspectionDelay",
        read: () =>
          namespaceTracking.getPendingInspectionDelay({
            ...entry.context,
            attempt,
            inspection: pendingInspection,
          }),
      });
      this.#entries.set(entry.transactionId, {
        ...entry,
        attempt,
        nextWakeAt: now + delay,
      });
      result.pending.push(entry.transactionId);
      return;
    }

    const failure: TransactionFailure = {
      reason: tracking.failure.reason,
      message: tracking.failure.message,
      data: cloneFailureData(tracking.failure.data),
    };
    const delay = this.#readInspectionDelay({
      namespace: entry.context.namespace,
      operation: "tracking.getRetryInspectionDelay",
      read: () =>
        namespaceTracking.getRetryInspectionDelay({
          ...entry.context,
          attempt,
          failure,
        }),
    });
    const nextWakeAt = now + delay;
    this.#entries.set(entry.transactionId, {
      ...entry,
      attempt,
      nextWakeAt,
    });
    result.retryLater.push({
      transactionId: entry.transactionId,
      reason: tracking.failure.reason,
      nextWakeAt,
    });
  }

  #requireNamespaceTracking(namespace: string): NamespaceTransactionTracking {
    const tracking = this.#getNamespaceTracking(namespace);
    if (!tracking) {
      throw new SubmittedTransactionTrackingUnsupportedError({
        namespace,
        operation: "tracking",
      });
    }
    return tracking;
  }

  #getNamespaceTracking(namespace: string): NamespaceTransactionTracking | undefined {
    return this.#namespaces.require(namespace).tracking;
  }

  #readInspectionDelay(input: { namespace: string; operation: string; read: () => number }): number {
    const delay = input.read();
    if (typeof delay === "number" && Number.isFinite(delay) && delay >= 0) {
      return delay;
    }

    throw new SubmittedTransactionTrackingCadenceError({
      namespace: input.namespace,
      operation: input.operation,
      ...(delay !== undefined ? { delay } : {}),
    });
  }

  #deriveCheckFailureCode(error: unknown): string {
    return isArxBaseError(error) ? error.code : "transaction.tracking.check_failed";
  }

  #getScopeNextWakeAt(scopeKey: string): number | null {
    let nextWakeAt: number | null = null;
    for (const entry of this.#entries.values()) {
      if (entry.scopeKey !== scopeKey) {
        continue;
      }
      if (nextWakeAt === null || entry.nextWakeAt < nextWakeAt) {
        nextWakeAt = entry.nextWakeAt;
      }
    }
    return nextWakeAt;
  }

  #markDirty(transactionIds: readonly string[] | undefined): void {
    if (!transactionIds) {
      this.#dirtyAll = true;
      this.#dirtyTransactionIds.clear();
      return;
    }

    for (const transactionId of transactionIds) {
      this.#dirtyTransactionIds.add(transactionId);
    }
  }

  #emitWakeChangedIfNeeded(): void {
    const nextWakeAt = this.getNextWakeAt();
    if (nextWakeAt === this.#lastEmittedWakeAt) {
      return;
    }

    this.#lastEmittedWakeAt = nextWakeAt;
    for (const handler of this.#wakeChangedHandlers) {
      try {
        handler(nextWakeAt);
      } catch {
        // Wake listeners schedule host work; they must not affect tracking state.
      }
    }
  }
}
