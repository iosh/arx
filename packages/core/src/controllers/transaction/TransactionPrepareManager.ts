import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canPrepareProposal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import { buildPrepareContext } from "./utils.js";

const DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS = 20_000;
const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

class TransactionPrepareTimeoutError extends Error {
  constructor() {
    super("Transaction preparation timed out.");
    this.name = "TransactionPrepareTimeoutError";
  }
}

const toPrepareReviewError = (error: unknown) => {
  if (error instanceof TransactionPrepareTimeoutError) {
    return {
      reason: "transaction.prepare_timeout",
      message: error.message,
    } as const;
  }

  if (error instanceof Error) {
    return {
      reason: "transaction.prepare_failed",
      message: error.message,
      data: { name: error.name },
    } as const;
  }

  return {
    reason: "transaction.prepare_failed",
    message: String(error),
  } as const;
};

type Options = {
  proposalStore: TransactionProposalStore;
  namespaces: NamespaceTransactions;
  logger?: (message: string, data?: unknown) => void;
  namespaceProposalPrepareTimeoutMs?: number;
  backgroundConcurrency?: number;
  now?: () => number;
};

export class TransactionPrepareManager {
  #proposalStore: TransactionProposalStore;
  #namespaces: NamespaceTransactions;
  #logger: (message: string, data?: unknown) => void;
  #namespaceProposalPrepareTimeoutMs: number;
  #now: () => number;

  #prepareInFlight: Map<string, { draftRevision: number; promise: Promise<void> }> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  #hasCurrentPrepared(id: string): boolean {
    return this.#proposalStore.getPreparedForExecution(id) !== null;
  }

  constructor(options: Options) {
    this.#proposalStore = options.proposalStore;
    this.#namespaces = options.namespaces;
    this.#logger = options.logger ?? (() => {});
    this.#namespaceProposalPrepareTimeoutMs =
      options.namespaceProposalPrepareTimeoutMs ?? DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
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

  async #prepareTransactionInBackground(id: string): Promise<void> {
    await this.#runPrepareUntilCurrent(id);
  }

  async #runPrepareUntilCurrent(id: string): Promise<void> {
    while (true) {
      const existing = this.#prepareInFlight.get(id);
      let settledDraftRevision: number;
      if (existing) {
        settledDraftRevision = existing.draftRevision;
        await existing.promise;
      } else {
        const initial = this.#proposalStore.peek(id);
        if (!initial) return;
        if (this.#hasCurrentPrepared(id) || !canPrepareProposal(initial)) {
          return;
        }
        settledDraftRevision = initial.draftRevision;

        const run = this.#prepareAndPersistInternal(id);
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
      if (!latest || this.#hasCurrentPrepared(id) || !canPrepareProposal(latest)) {
        return;
      }
      if (latest.draftRevision === settledDraftRevision) {
        return;
      }
    }
  }

  async #prepareAndPersistInternal(id: string): Promise<void> {
    const timeoutMs = this.#namespaceProposalPrepareTimeoutMs;

    const state = this.#proposalStore.peek(id);
    if (!state) return;

    const expectedDraftRevision = state.draftRevision;
    const meta = this.#proposalStore.get(id);
    if (!meta) return;

    if (this.#hasCurrentPrepared(id)) {
      return;
    }

    // No need to prepare once a tx is no longer eligible for enrichment.
    if (!canPrepareProposal(state)) {
      return;
    }

    const startedAt = this.#now();
    const session = this.#proposalStore.getOrStartPrepare({
      id,
      updatedAt: startedAt,
    });
    if (!session) {
      return;
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction) {
      const next = this.#proposalStore.settlePrepareFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: this.#now(),
        error: {
          reason: "transaction.adapter_missing",
          message: `No namespace transaction registered for namespace ${meta.namespace}`,
          data: { namespace: meta.namespace },
        },
        reviewPreparedSnapshot: null,
      });
      if (!next) return;
      return;
    }

    try {
      const context = buildPrepareContext(meta);
      const prepare = requireNamespaceTransactionOperation({
        namespace: meta.namespace,
        operation: "proposal.prepare",
        value: namespaceTransaction.proposal?.prepare,
      });
      const runPrepare = async () => await this.#withTimeout(prepare(context), timeoutMs);
      const result = await this.#withPrepareSlot(runPrepare);

      const reviewPreparedSnapshot = result.prepared ?? null;
      const settledAt = this.#now();

      if (result.status === "ready") {
        const next = this.#proposalStore.settlePrepareReady({
          id,
          expectedDraftRevision,
          sessionToken: session.sessionToken,
          updatedAt: settledAt,
          executionPrepared: result.prepared,
          reviewPreparedSnapshot,
        });
        if (!next) return;
        return;
      }

      if (result.status === "blocked") {
        const next = this.#proposalStore.settlePrepareBlocked({
          id,
          expectedDraftRevision,
          sessionToken: session.sessionToken,
          updatedAt: settledAt,
          blocker: result.blocker,
          reviewPreparedSnapshot,
        });
        if (!next) return;
        return;
      }

      const next = this.#proposalStore.settlePrepareFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: settledAt,
        error: result.error,
        reviewPreparedSnapshot,
      });
      if (!next) return;
      return;
    } catch (error) {
      const next = this.#proposalStore.settlePrepareFailed({
        id,
        expectedDraftRevision,
        sessionToken: session.sessionToken,
        updatedAt: this.#now(),
        error: toPrepareReviewError(error),
        reviewPreparedSnapshot: null,
      });
      if (!next) return;
      return;
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
        reject(new TransactionPrepareTimeoutError());
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
