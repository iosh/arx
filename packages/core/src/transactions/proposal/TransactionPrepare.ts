import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../namespace/operations.js";
import { canPrepareProposal } from "../status.js";
import { buildPrepareContext } from "../utils.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

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
  TransactionProposalRuntime,
  | "peek"
  | "get"
  | "getPreparedForExecution"
  | "getOrStartPrepare"
  | "restartPrepare"
  | "settlePrepareReady"
  | "settlePrepareBlocked"
  | "settlePrepareFailed"
>;

type TransactionPrepareDeps = {
  proposalRuntime: TransactionPrepareState;
  namespaces: Pick<NamespaceTransactions, "get">;
  now: () => number;
  logger?: (message: string, data?: unknown) => void;
  backgroundConcurrency?: number;
  namespaceProposalPrepareTimeoutMs?: number;
};

type PrepareAttempt = {
  id: string;
  meta: NonNullable<ReturnType<TransactionProposalRuntime["get"]>>;
  expectedRequestRevision: number;
  sessionToken: string;
};

type PrepareOutcome =
  | {
      status: "ready";
      updatedAt: number;
      prepared: NonNullable<NonNullable<ReturnType<TransactionProposalRuntime["get"]>>["prepared"]>;
      reviewSnapshot: Parameters<TransactionProposalRuntime["settlePrepareReady"]>[0]["reviewSnapshot"];
    }
  | {
      status: "blocked";
      updatedAt: number;
      blocker: NonNullable<Parameters<TransactionProposalRuntime["settlePrepareBlocked"]>[0]["blocker"]>;
      reviewSnapshot: Parameters<TransactionProposalRuntime["settlePrepareBlocked"]>[0]["reviewSnapshot"];
    }
  | {
      status: "failed";
      updatedAt: number;
      error: NonNullable<Parameters<TransactionProposalRuntime["settlePrepareFailed"]>[0]["error"]>;
      reviewSnapshot: Parameters<TransactionProposalRuntime["settlePrepareFailed"]>[0]["reviewSnapshot"];
    };

export class TransactionPrepare {
  #proposalRuntime: TransactionPrepareState;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #now: () => number;
  #logger: (message: string, data?: unknown) => void;
  #namespaceProposalPrepareTimeoutMs: number;

  #prepareInFlight: Map<string, { requestRevision: number; promise: Promise<void> }> = new Map();
  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(deps: TransactionPrepareDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
    this.#namespaces = deps.namespaces;
    this.#now = deps.now;
    this.#logger = deps.logger ?? (() => {});
    this.#prepareConcurrencyLimit = Math.max(1, deps.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY);
    this.#namespaceProposalPrepareTimeoutMs =
      deps.namespaceProposalPrepareTimeoutMs ?? DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS;
  }

  queue(id: string) {
    const proposal = this.#proposalRuntime.peek(id);
    if (!proposal || this.#hasCurrentPrepared(id) || !canPrepareProposal(proposal)) {
      return;
    }

    this.#proposalRuntime.getOrStartPrepare({
      id,
      requestRevision: proposal.prepare.requestRevision,
      updatedAt: this.#now(),
    });
    this.#queuePrepareInBackground(id);
  }

  rerun(id: string) {
    const proposal = this.#proposalRuntime.peek(id);
    if (!proposal || !canPrepareProposal(proposal)) {
      return;
    }

    this.#proposalRuntime.restartPrepare({
      id,
      requestRevision: proposal.prepare.requestRevision,
      updatedAt: this.#now(),
    });
    this.#queuePrepareInBackground(id);
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
      let settledRequestRevision: number;
      if (existing) {
        settledRequestRevision = existing.requestRevision;
        await existing.promise;
      } else {
        const initial = this.#proposalRuntime.peek(id);
        if (!initial) {
          return;
        }
        if (this.#hasCurrentPrepared(id) || !canPrepareProposal(initial)) {
          return;
        }
        settledRequestRevision = initial.prepare.requestRevision;

        const run = this.#withPrepareSlot(async () => {
          await this.prepareCurrentDraft(id);
        });
        const tracked = run
          .then(() => undefined)
          .finally(() => {
            this.#prepareInFlight.delete(id);
          });

        this.#prepareInFlight.set(id, {
          requestRevision: initial.prepare.requestRevision,
          promise: tracked,
        });
        await tracked;
      }

      const latest = this.#proposalRuntime.peek(id);
      if (!latest || this.#hasCurrentPrepared(id) || !canPrepareProposal(latest)) {
        return;
      }
      if (latest.prepare.requestRevision === settledRequestRevision) {
        return;
      }
    }
  }

  #hasCurrentPrepared(id: string): boolean {
    return this.#proposalRuntime.getPreparedForExecution(id) !== null;
  }

  #startPrepareAttempt(id: string): PrepareAttempt | null {
    const state = this.#proposalRuntime.peek(id);
    if (!state || !canPrepareProposal(state) || state.prepare.prepared !== null) {
      return null;
    }

    const meta = this.#proposalRuntime.get(id);
    if (!meta) {
      return null;
    }

    const session = this.#proposalRuntime.getOrStartPrepare({
      id,
      requestRevision: state.prepare.requestRevision,
      updatedAt: this.#now(),
    });
    if (session.status !== "opened") {
      return null;
    }

    return {
      id,
      meta,
      expectedRequestRevision: state.prepare.requestRevision,
      sessionToken: session.review.sessionToken,
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
        reviewSnapshot: null,
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
      const reviewSnapshot = result.status === "ready" ? result.prepared : (result.reviewSnapshot ?? null);

      if (result.status === "ready") {
        return {
          status: "ready",
          updatedAt,
          prepared: result.prepared,
          reviewSnapshot,
        };
      }

      if (result.status === "blocked") {
        return {
          status: "blocked",
          updatedAt,
          blocker: result.blocker,
          reviewSnapshot,
        };
      }

      return {
        status: "failed",
        updatedAt,
        error: result.error,
        reviewSnapshot,
      };
    } catch (error) {
      return {
        status: "failed",
        updatedAt: this.#now(),
        error: toPrepareReviewError(error),
        reviewSnapshot: null,
      };
    }
  }

  #applyPrepareOutcome(attempt: PrepareAttempt, outcome: PrepareOutcome): void {
    const current = this.#proposalRuntime.peek(attempt.id);
    if (
      !current ||
      current.prepare.requestRevision !== attempt.expectedRequestRevision ||
      !canPrepareProposal(current)
    ) {
      return;
    }

    switch (outcome.status) {
      case "ready": {
        const settled = this.#proposalRuntime.settlePrepareReady({
          id: attempt.id,
          expectedRequestRevision: attempt.expectedRequestRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          executionPrepared: outcome.prepared,
          reviewSnapshot: outcome.reviewSnapshot,
        });
        if (settled.status === "settled") {
          return;
        }
        return;
      }
      case "blocked": {
        const settled = this.#proposalRuntime.settlePrepareBlocked({
          id: attempt.id,
          expectedRequestRevision: attempt.expectedRequestRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          blocker: outcome.blocker,
          reviewSnapshot: outcome.reviewSnapshot,
        });
        if (settled.status === "settled") {
          return;
        }
        return;
      }
      case "failed": {
        const settled = this.#proposalRuntime.settlePrepareFailed({
          id: attempt.id,
          expectedRequestRevision: attempt.expectedRequestRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          error: outcome.error,
          reviewSnapshot: outcome.reviewSnapshot,
        });
        if (settled.status === "settled") {
          return;
        }
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
