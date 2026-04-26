import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import type { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import type { TransactionReviewSessions } from "./review/session.js";
import { isPrepareEligibleTransactionStatus } from "./status.js";
import type { TransactionMeta } from "./types.js";
import { buildPrepareContext } from "./utils.js";

const DEFAULT_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

type Options = {
  runtime: RuntimeTransactionStore;
  namespaces: NamespaceTransactions;
  reviewSessions: TransactionReviewSessions;
  logger?: (message: string, data?: unknown) => void;
  prepareTimeoutMs?: number;
  backgroundConcurrency?: number;
  onReviewSessionChanged?: (transactionId: string, updatedAt: number) => void;
};

export class TransactionPrepareManager {
  #runtime: RuntimeTransactionStore;
  #namespaces: NamespaceTransactions;
  #reviewSessions: TransactionReviewSessions;
  #logger: (message: string, data?: unknown) => void;
  #onReviewSessionChanged: (transactionId: string, updatedAt: number) => void;
  #timeoutMs: number;

  #prepareInFlight: Map<string, { draftRevision: number; promise: Promise<void> }> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(options: Options) {
    this.#runtime = options.runtime;
    this.#namespaces = options.namespaces;
    this.#reviewSessions = options.reviewSessions;
    this.#logger = options.logger ?? (() => {});
    this.#onReviewSessionChanged = options.onReviewSessionChanged ?? (() => {});
    this.#timeoutMs = options.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
    this.#prepareConcurrencyLimit = Math.max(
      1,
      options.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY,
    );
  }

  queuePrepare(id: string) {
    void this.ensurePrepared(id, { source: "background" }).catch((error) => {
      // Best-effort background preparation; failures are surfaced via review state.
      this.#logger("transactions: prepare failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async ensurePrepared(
    id: string,
    opts?: { timeoutMs?: number; source?: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    while (true) {
      const existing = this.#prepareInFlight.get(id);
      let settledDraftRevision: number;
      if (existing) {
        settledDraftRevision = existing.draftRevision;
        await existing.promise;
      } else {
        const initial = this.#runtime.peek(id);
        if (!initial) return null;
        if (initial.prepared || !isPrepareEligibleTransactionStatus(initial.status)) {
          return this.#runtime.get(id) ?? null;
        }
        settledDraftRevision = initial.draftRevision;

        const run = this.#prepareAndPersistInternal(id, opts);
        const tracked = run
          .then(() => undefined)
          .finally(() => {
            this.#prepareInFlight.delete(id);
          });

        this.#prepareInFlight.set(id, {
          draftRevision: initial.draftRevision,
          promise: tracked,
        });
        await tracked;
      }

      const latest = this.#runtime.peek(id);
      if (!latest || latest.prepared || !isPrepareEligibleTransactionStatus(latest.status)) {
        return latest ? (this.#runtime.get(id) ?? null) : null;
      }
      if (latest.draftRevision === settledDraftRevision) {
        return this.#runtime.get(id) ?? null;
      }
    }
  }

  async #prepareAndPersistInternal(
    id: string,
    opts?: { timeoutMs?: number; source?: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    const timeoutMs = opts?.timeoutMs ?? this.#timeoutMs;

    const state = this.#runtime.peek(id);
    if (!state) return null;

    const expectedDraftRevision = state.draftRevision;
    const meta = this.#runtime.get(id);
    if (!meta) return null;

    if (state.prepared) {
      return meta;
    }

    // No need to prepare once a tx is no longer eligible for enrichment.
    if (!isPrepareEligibleTransactionStatus(state.status)) {
      return meta;
    }

    const session = this.#reviewSessions.begin(id, Date.now());
    this.#runtime.patch(id, { updatedAt: meta.updatedAt });

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      const next = this.#runtime.commitPrepared(id, expectedDraftRevision, null);
      if (!next) return this.#runtime.get(id) ?? null;
      const changed = this.#reviewSessions.markFailed(id, session.sessionToken, next.updatedAt, {
        reason: "transaction.adapter_missing",
        message: `No namespace transaction registered for namespace ${meta.namespace}`,
        data: { namespace: meta.namespace },
      });
      if (changed) this.#onReviewSessionChanged(id, changed.updatedAt);
      return next;
    }

    try {
      const context = buildPrepareContext(meta);
      const prepare = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "proposal.prepare",
        value: namespaceTransaction.proposal?.prepare,
      });
      const runPrepare = async () => await this.#withTimeout(prepare(context), timeoutMs);
      const result = opts?.source === "background" ? await this.#withPrepareSlot(runPrepare) : await runPrepare();

      const reviewPreparedSnapshot = result.prepared ?? null;
      const executionPrepared = result.status === "ready" ? result.prepared : null;
      const next = this.#runtime.commitPrepared(id, expectedDraftRevision, executionPrepared);
      if (!next) return this.#runtime.get(id) ?? null;

      if (result.status === "ready") {
        const changed = this.#reviewSessions.markReady(id, session.sessionToken, next.updatedAt, result.prepared);
        if (changed) this.#onReviewSessionChanged(id, changed.updatedAt);
        return next;
      }

      if (result.status === "blocked") {
        const changed = this.#reviewSessions.markBlocked(
          id,
          session.sessionToken,
          next.updatedAt,
          result.blocker,
          reviewPreparedSnapshot,
        );
        if (changed) this.#onReviewSessionChanged(id, changed.updatedAt);
        return next;
      }

      const changed = this.#reviewSessions.markFailed(
        id,
        session.sessionToken,
        next.updatedAt,
        result.error,
        reviewPreparedSnapshot,
      );
      if (changed) this.#onReviewSessionChanged(id, changed.updatedAt);
      return next;
    } catch (error) {
      const next = this.#runtime.commitPrepared(id, expectedDraftRevision, null);
      if (!next) return this.#runtime.get(id) ?? null;
      const reviewError =
        error instanceof Error
          ? {
              reason:
                error.name === "TransactionPrepareTimeoutError"
                  ? "transaction.prepare_timeout"
                  : "transaction.prepare_failed",
              message: error.message,
              ...(error.name ? { data: { name: error.name } } : {}),
            }
          : {
              reason: "transaction.prepare_failed",
              message: String(error),
            };
      const changed = this.#reviewSessions.markFailed(id, session.sessionToken, next.updatedAt, reviewError);
      if (changed) this.#onReviewSessionChanged(id, changed.updatedAt);
      return next;
    }
  }

  async #withPrepareSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#prepareConcurrencyInUse >= this.#prepareConcurrencyLimit) {
      // Wait for a slot to be handed off by a releasing task.
      await new Promise<void>((resolve) => {
        this.#prepareConcurrencyWaiters.push(resolve);
      });
    } else {
      this.#prepareConcurrencyInUse += 1;
    }
    try {
      return await fn();
    } finally {
      const waiter = this.#prepareConcurrencyWaiters.shift();
      if (waiter) {
        // Hand off the slot directly to the next waiter (keep inUse unchanged).
        waiter();
      } else {
        this.#prepareConcurrencyInUse = Math.max(0, this.#prepareConcurrencyInUse - 1);
      }
    }
  }

  async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      // Simple timeout guard for slow/unresponsive RPC nodes.
      timer = setTimeout(() => {
        const error = new Error("Transaction preparation timed out.");
        error.name = "TransactionPrepareTimeoutError";
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
