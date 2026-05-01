import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canPrepareProposal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionMeta } from "./types.js";
import { buildPrepareContext } from "./utils.js";

const DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

type Options = {
  proposalStore: TransactionProposalStore;
  namespaces: NamespaceTransactions;
  logger?: (message: string, data?: unknown) => void;
  namespaceProposalPrepareTimeoutMs?: number;
  backgroundConcurrency?: number;
};

export class TransactionPrepareManager {
  #proposalStore: TransactionProposalStore;
  #namespaces: NamespaceTransactions;
  #logger: (message: string, data?: unknown) => void;
  #namespaceProposalPrepareTimeoutMs: number;

  #prepareInFlight: Map<string, { draftRevision: number; promise: Promise<void> }> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(options: Options) {
    this.#proposalStore = options.proposalStore;
    this.#namespaces = options.namespaces;
    this.#logger = options.logger ?? (() => {});
    this.#namespaceProposalPrepareTimeoutMs =
      options.namespaceProposalPrepareTimeoutMs ?? DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS;
    this.#prepareConcurrencyLimit = Math.max(
      1,
      options.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY,
    );
  }

  queuePrepare(id: string) {
    void this.#prepareTransactionInBackground(id).catch((error) => {
      // Best-effort background preparation; failures are surfaced via review state.
      this.#logger("transactions: prepare failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async prepareTransactionForExecution(id: string): Promise<TransactionMeta | null> {
    return await this.#runPrepareUntilCurrent(id, { source: "execution" });
  }

  async #prepareTransactionInBackground(id: string): Promise<TransactionMeta | null> {
    return await this.#runPrepareUntilCurrent(id, { source: "background" });
  }

  async #runPrepareUntilCurrent(
    id: string,
    opts: { source: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    while (true) {
      const existing = this.#prepareInFlight.get(id);
      let settledDraftRevision: number;
      if (existing) {
        settledDraftRevision = existing.draftRevision;
        await existing.promise;
      } else {
        const initial = this.#proposalStore.peek(id);
        if (!initial) return null;
        if (initial.prepared || !canPrepareProposal(initial)) {
          return this.#proposalStore.get(id) ?? null;
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

      const latest = this.#proposalStore.peek(id);
      if (!latest || latest.prepared || !canPrepareProposal(latest)) {
        return latest ? (this.#proposalStore.get(id) ?? null) : null;
      }
      if (latest.draftRevision === settledDraftRevision) {
        return this.#proposalStore.get(id) ?? null;
      }
    }
  }

  async #prepareAndPersistInternal(
    id: string,
    opts: { source: "background" | "execution" },
  ): Promise<TransactionMeta | null> {
    const timeoutMs = this.#namespaceProposalPrepareTimeoutMs;

    const state = this.#proposalStore.peek(id);
    if (!state) return null;

    const expectedDraftRevision = state.draftRevision;
    const meta = this.#proposalStore.get(id);
    if (!meta) return null;

    if (state.prepared) {
      return meta;
    }

    // No need to prepare once a tx is no longer eligible for enrichment.
    if (!canPrepareProposal(state)) {
      return meta;
    }

    const startedAt = Date.now();
    const session = this.#proposalStore.beginPrepareSession({ id, updatedAt: startedAt });
    if (!session) {
      return this.#proposalStore.get(id) ?? null;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      const next = this.#proposalStore.commitPrepared(id, expectedDraftRevision, null);
      if (!next) return this.#proposalStore.get(id) ?? null;
      this.#proposalStore.markReviewFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: next.updatedAt,
        error: {
          reason: "transaction.adapter_missing",
          message: `No namespace transaction registered for namespace ${meta.namespace}`,
          data: { namespace: meta.namespace },
        },
        reviewPreparedSnapshot: null,
      });
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
      const result = opts.source === "background" ? await this.#withPrepareSlot(runPrepare) : await runPrepare();

      const reviewPreparedSnapshot = result.prepared ?? null;
      const executionPrepared = result.status === "ready" ? result.prepared : null;
      const next = this.#proposalStore.commitPrepared(id, expectedDraftRevision, executionPrepared);
      if (!next) return this.#proposalStore.get(id) ?? null;

      if (result.status === "ready") {
        this.#proposalStore.markReviewReady({
          id,
          expectedDraftRevision,
          sessionToken: session.sessionToken,
          updatedAt: next.updatedAt,
          reviewPreparedSnapshot: result.prepared,
        });
        return next;
      }

      if (result.status === "blocked") {
        this.#proposalStore.markReviewBlocked({
          id,
          expectedDraftRevision,
          sessionToken: session.sessionToken,
          updatedAt: next.updatedAt,
          blocker: result.blocker,
          reviewPreparedSnapshot,
        });
        return next;
      }

      this.#proposalStore.markReviewFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: next.updatedAt,
        error: result.error,
        reviewPreparedSnapshot,
      });
      return next;
    } catch (error) {
      const next = this.#proposalStore.commitPrepared(id, expectedDraftRevision, null);
      if (!next) return this.#proposalStore.get(id) ?? null;
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
      this.#proposalStore.markReviewFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: next.updatedAt,
        error: reviewError,
        reviewPreparedSnapshot: null,
      });
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
