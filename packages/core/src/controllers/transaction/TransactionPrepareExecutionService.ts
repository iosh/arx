import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import { requireNamespaceTransactionOperation } from "../../transactions/namespace/operations.js";
import { canPrepareProposal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import { buildPrepareContext } from "./utils.js";

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

type TransactionPrepareExecutionServiceDeps = {
  proposalStore: Pick<TransactionProposalStore, "peek" | "get" | "updatePreparedForDraft">;
  reviewStore: Pick<
    TransactionReviewSessionStore,
    "getOrStartPrepare" | "settlePrepareReady" | "settlePrepareBlocked" | "settlePrepareFailed"
  >;
  namespaces: Pick<NamespaceTransactions, "get">;
  namespaceProposalPrepareTimeoutMs?: number;
  now?: () => number;
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
      blocker: NonNullable<Parameters<TransactionReviewSessionStore["settlePrepareBlocked"]>[0]["blocker"]>;
      reviewPreparedSnapshot: NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"];
    }
  | {
      status: "failed";
      updatedAt: number;
      error: NonNullable<Parameters<TransactionReviewSessionStore["settlePrepareFailed"]>[0]["error"]>;
      reviewPreparedSnapshot: NonNullable<ReturnType<TransactionProposalStore["get"]>>["prepared"];
    };

export class TransactionPrepareExecutionService {
  #proposalStore: Pick<TransactionProposalStore, "peek" | "get" | "updatePreparedForDraft">;
  #reviewStore: Pick<
    TransactionReviewSessionStore,
    "getOrStartPrepare" | "settlePrepareReady" | "settlePrepareBlocked" | "settlePrepareFailed"
  >;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #namespaceProposalPrepareTimeoutMs: number;
  #now: () => number;

  constructor(deps: TransactionPrepareExecutionServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#reviewStore = deps.reviewStore;
    this.#namespaces = deps.namespaces;
    this.#namespaceProposalPrepareTimeoutMs =
      deps.namespaceProposalPrepareTimeoutMs ?? DEFAULT_NAMESPACE_PROPOSAL_PREPARE_TIMEOUT_MS;
    this.#now = deps.now ?? Date.now;
  }

  async prepareCurrentDraft(id: string): Promise<void> {
    const attempt = this.#startPrepareAttempt(id);
    if (!attempt) {
      return;
    }

    const outcome = await this.#resolvePrepareOutcome(attempt);
    this.#applyPrepareOutcome(attempt, outcome);
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

    const session = this.#reviewStore.getOrStartPrepare({
      id,
      draftRevision: state.draftRevision,
      updatedAt: this.#now(),
    });

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
        const review = this.#reviewStore.settlePrepareReady({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        if (!review) {
          return;
        }
        this.#proposalStore.updatePreparedForDraft({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          updatedAt: outcome.updatedAt,
          prepared: outcome.prepared,
        });
        return;
      }
      case "blocked": {
        const review = this.#reviewStore.settlePrepareBlocked({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          blocker: outcome.blocker,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        if (!review) {
          return;
        }
        this.#proposalStore.updatePreparedForDraft({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          updatedAt: outcome.updatedAt,
          prepared: null,
        });
        return;
      }
      case "failed": {
        const review = this.#reviewStore.settlePrepareFailed({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          sessionToken: attempt.sessionToken,
          updatedAt: outcome.updatedAt,
          error: outcome.error,
          reviewPreparedSnapshot: outcome.reviewPreparedSnapshot,
        });
        if (!review) {
          return;
        }
        this.#proposalStore.updatePreparedForDraft({
          id: attempt.id,
          expectedDraftRevision: attempt.expectedDraftRevision,
          updatedAt: outcome.updatedAt,
          prepared: null,
        });
        return;
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
