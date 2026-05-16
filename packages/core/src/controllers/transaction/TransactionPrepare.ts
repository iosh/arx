import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canPrepareProposal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import { buildPrepareContext } from "./utils.js";

const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;
const DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS = 20_000;

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

type TransactionPrepareState = Pick<
  TransactionProposalStore,
  | "peek"
  | "get"
  | "getPreparedForExecution"
  | "getOrStartPrepare"
  | "restartPrepare"
  | "settlePrepareReady"
  | "settlePrepareBlocked"
  | "settlePrepareFailed"
  | "clearPrepareState"
>;

type TransactionPrepareDeps = {
  proposalStore: TransactionPrepareState;
  namespaces: Pick<NamespaceTransactions, "get">;
  now: () => number;
  logger?: (message: string, data?: unknown) => void;
  backgroundConcurrency?: number;
  namespaceProposalPrepareTimeoutMs?: number;
};

type PrepareAttempt = {
  id: string;
  meta: NonNullable<ReturnType<TransactionProposalStore["get"]>>;
  expectedDraftRevision: number;
  sessionToken: string;
};

type PrepareOutcome =
  | {
      status: "ready";
      updatedAt: number;
      prepared: NonNullable<NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"]>;
      reviewPreparedSnapshot: NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"];
    }
  | {
      status: "blocked";
      updatedAt: number;
      blocker: NonNullable<Parameters<TransactionProposalStore["settlePrepareBlocked"]>[0]["blocker"]>;
      reviewPreparedSnapshot: NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"];
    }
  | {
      status: "failed";
      updatedAt: number;
      error: NonNullable<Parameters<TransactionProposalStore["settlePrepareFailed"]>[0]["error"]>;
      reviewPreparedSnapshot: NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"];
    };

export class TransactionPrepare {
  #proposalStore: TransactionPrepareState;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #now: () => number;
  #logger: (message: string, data?: unknown) => void;
  #namespaceProposalPrepareTimeoutMs: number;

  #prepareInFlight: Map<string, { draftRevision: number; promise: Promise<void> }> = new Map();
  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(deps: TransactionPrepareDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#namespaces = deps.namespaces;
    this.#now = deps.now;
    this.#logger = deps.logger ?? (() => {});
    this.#prepareConcurrencyLimit = Math.max(1, deps.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY);
    this.#namespaceProposalPrepareTimeoutMs =
      deps.namespaceProposalPrepareTimeoutMs ?? DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS;
  }

  queue(id: string) {
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || this.#hasCurrentPrepared(id) || !canPrepareProposal(proposal)) {
      return;
    }

    this.#proposalStore.getOrStartPrepare({
      id,
      draftRevision: proposal.draftRevision,
      updatedAt: this.#now(),
    });
    this.#queuePrepareInBackground(id);
  }

  rerun(id: string) {
    const proposal = this.#proposalStore.peek(id);
    if (!proposal || !canPrepareProposal(proposal)) {
      return;
    }

    this.#proposalStore.restartPrepare({
      id,
      draftRevision: proposal.draftRevision,
      updatedAt: this.#now(),
    });
    this.#queuePrepareInBackground(id);
  }

  discard(id: string) {
    this.#proposalStore.clearPrepareState({
      id,
      updatedAt: this.#now(),
    });
  }

  async prepareCurrentDraft(id: string): Promise<void> {
    const attempt = this.#startPrepareAttempt(id);
    if (!attempt) {
      return;
    }

    const outcome = await this.#resolvePrepareOutcome(attempt);
    this.#applyPrepareOutcome(attempt, outcome);
  }

  #queuePrepareInBackground(id: string) {
    void this.#prepareTransactionInBackground(id).catch((error) => {
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
        if (!initial) {
          return;
        }
        if (this.#hasCurrentPrepared(id) || !canPrepareProposal(initial)) {
          return;
        }
        settledDraftRevision = initial.draftRevision;

        const run = this.#withPrepareSlot(async () => {
          await this.prepareCurrentDraft(id);
        });
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

  #hasCurrentPrepared(id: string): boolean {
    return this.#proposalStore.getPreparedForExecution(id) !== null;
  }

  #startPrepareAttempt(id: string): PrepareAttempt | null {
    const state = this.#proposalStore.peek(id);
    if (!state || !canPrepareProposal(state) || state.prepared !== null) {
      return null;
    }

    const meta = this.#proposalStore.get(id);
    if (!meta) {
      return null;
    }

    const session = this.#proposalStore.getOrStartPrepare({
      id,
      draftRevision: state.draftRevision,
      updatedAt: this.#now(),
    });
    if (!session) {
      return null;
    }

    return {
      id,
      meta,
      expectedDraftRevision: state.draftRevision,
      sessionToken: session.sessionToken,
    };
  }

  async #resolvePrepareOutcome(attempt: PrepareAttempt): Promise<PrepareOutcome> {
    const namespaceTransaction = this.#namespaces.get(attempt.meta.namespace);
    if (!namespaceTransaction) {
      return {
        status: "failed",
        updatedAt: this.#now(),
        error: {
          reason: "transaction.adapter_missing",
          message: `No namespace transaction registered for namespace ${attempt.meta.namespace}`,
          data: { namespace: attempt.meta.namespace },
        },
        reviewPreparedSnapshot: null,
      };
    }

    try {
      const context = buildPrepareContext(attempt.meta);
      const prepare = requireNamespaceTransactionOperation({
        namespace: attempt.meta.namespace,
        operation: "proposal.prepare",
        value: namespaceTransaction.proposal?.prepare,
      });
      const result = await this.#withTimeout(prepare(context), this.#namespaceProposalPrepareTimeoutMs);
      const updatedAt = this.#now();
      const reviewPreparedSnapshot = result.prepared ?? null;

      if (result.status === "ready") {
        return {
          status: "ready",
          updatedAt,
          prepared: result.prepared,
          reviewPreparedSnapshot,
        };
      }

      if (result.status === "blocked") {
        return {
          status: "blocked",
          updatedAt,
          blocker: result.blocker,
          reviewPreparedSnapshot,
        };
      }

      return {
        status: "failed",
        updatedAt,
        error: result.error,
        reviewPreparedSnapshot,
      };
    } catch (error) {
      return {
        status: "failed",
        updatedAt: this.#now(),
        error: toPrepareReviewError(error),
        reviewPreparedSnapshot: null,
      };
    }
  }

  #applyPrepareOutcome(attempt: PrepareAttempt, outcome: PrepareOutcome): void {
    const current = this.#proposalStore.peek(attempt.id);
    if (!current || current.draftRevision !== attempt.expectedDraftRevision || !canPrepareProposal(current)) {
      return;
    }

    switch (outcome.status) {
      case "ready": {
        this.#proposalStore.settlePrepareReady({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          executionPrepared: outcome.prepared,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        return;
      }
      case "blocked": {
        this.#proposalStore.settlePrepareBlocked({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          blocker: outcome.blocker,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        return;
      }
      case "failed": {
        this.#proposalStore.settlePrepareFailed({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          error: outcome.error,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        return;
      }
    }
  }

  async #withPrepareSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#prepareConcurrencyInUse >= this.#prepareConcurrencyLimit) {
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
        waiter();
      } else {
        this.#prepareConcurrencyInUse = Math.max(0, this.#prepareConcurrencyInUse - 1);
      }
    }
  }

  async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TransactionPrepareTimeoutError());
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
