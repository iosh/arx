import type { JsonValue, TransactionAggregate } from "../aggregate/index.js";
import { cloneJsonValue } from "../aggregate/json.js";
import type { TransactionAggregateStore } from "../aggregate/TransactionAggregateStore.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type {
  NamespaceTransactionProposal,
  TransactionApprovalFinalizeResult,
  TransactionApprovalResourceKey,
  TransactionPrepareResult,
  TransactionProposalError,
} from "../namespace/types.js";
import { TransactionResourceLock } from "../TransactionResourceLock.js";
import type { TransactionPrepared, TransactionRequest } from "../types.js";
import { TransactionApprovalSessionInvariantError, TransactionApprovalSessionNotFoundError } from "./errors.js";
import type {
  ApproveTransactionApprovalSessionInput,
  ApproveTransactionApprovalSessionResult,
  EditTransactionApprovalSessionInput,
  OpenTransactionApprovalSessionInput,
  PrepareTransactionApprovalSessionInput,
  ResolveTransactionApprovalSessionInput,
  TransactionApprovalSession,
} from "./types.js";

type TransactionApprovalSessionServiceDeps = {
  transactions: Pick<TransactionAggregateStore, "createApprovedTransaction" | "listTransactionHistory">;
  namespaces: Pick<NamespaceTransactions, "require">;
  resourceLock: TransactionResourceLock;
  now?: () => number;
  createId?: () => string;
};

type ReadyApprovalSession = TransactionApprovalSession & {
  prepare: Extract<TransactionApprovalSession["prepare"], { status: "ready" }>;
};

type FinalizationReviewResult = Exclude<TransactionApprovalFinalizeResult, { status: "approved" | "approval_stale" }>;

type ActiveLocalApproval = {
  transactionId: string;
  status: "submitting" | "submitted";
  approvedPayload: TransactionPrepared;
  conflictKey: TransactionAggregate["record"]["conflictKey"];
};

export class TransactionApprovalSessionService {
  #transactions: Pick<TransactionAggregateStore, "createApprovedTransaction" | "listTransactionHistory">;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #resourceLock: TransactionResourceLock;
  #now: () => number;
  #createId: () => string;
  #sessions = new Map<string, TransactionApprovalSession>();
  #sessionLock = new TransactionResourceLock();

  constructor(deps: TransactionApprovalSessionServiceDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#resourceLock = deps.resourceLock;
    this.#now = deps.now ?? Date.now;
    this.#createId = deps.createId ?? (() => crypto.randomUUID());
  }

  getSessionByApprovalId(approvalId: string): TransactionApprovalSession | null {
    const session = this.#sessions.get(approvalId);
    return session ? structuredClone(session) : null;
  }

  listSessions(): TransactionApprovalSession[] {
    return [...this.#sessions.values()].map((session) => structuredClone(session));
  }

  discardSessionByApprovalId(approvalId: string): TransactionApprovalSession | null {
    const session = this.#sessions.get(approvalId);
    if (!session) {
      return null;
    }

    this.#sessions.delete(approvalId);
    return structuredClone(session);
  }

  async openSession(input: OpenTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const opened = await this.#withSessionLock(input.approvalId, async () => {
      const existing = this.#sessions.get(input.approvalId);
      if (existing) {
        return {
          shouldPrepare: false as const,
          session: structuredClone(existing),
        };
      }

      const openedAt = this.#now();
      const session: TransactionApprovalSession = {
        approvalId: input.approvalId,
        namespace: input.namespace,
        chainRef: input.chainRef,
        source: input.source,
        origin: input.origin,
        accountKey: input.accountKey,
        from: input.from,
        requestId: input.requestId ?? null,
        replacement: structuredClone(input.replacement),
        createdAt: openedAt,
        draft: {
          payload: cloneJsonValue(input.request.payload),
          revision: 0,
          updatedAt: openedAt,
        },
        prepare: this.#createPreparingState(0, openedAt),
        review: null,
      };

      this.#sessions.set(input.approvalId, session);
      return {
        shouldPrepare: true as const,
        session,
      };
    });

    return opened.shouldPrepare ? await this.#runPrepare(opened.session) : opened.session;
  }

  async prepareSession(input: PrepareTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const restarted = await this.#withSessionLock(input.approvalId, async () => {
      const current = this.#loadOpenSessionOrThrow(input.approvalId);
      return this.#startPrepareRun(current);
    });

    return await this.#runPrepare(restarted);
  }

  async applyDraftEdit(input: EditTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const edited = await this.#withSessionLock(input.approvalId, async () => {
      const current = this.#loadOpenSessionOrThrow(input.approvalId);

      const proposal = this.#requireProposal(current.namespace);
      if (!proposal.applyDraftEdit) {
        throw new TransactionApprovalSessionInvariantError(
          current.approvalId,
          `Namespace "${current.namespace}" does not support transaction draft edits.`,
        );
      }

      const nextRequest = proposal.applyDraftEdit({
        transactionId: current.approvalId,
        namespace: current.namespace,
        chainRef: current.chainRef,
        origin: current.origin,
        from: current.from,
        request: this.#buildDraftRequest(current),
        edit: input.edit,
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
      });

      const updatedAt = this.#now();
      const nextDraftRevision = current.draft.revision + 1;
      const nextSession: TransactionApprovalSession = {
        ...current,
        draft: {
          payload: cloneJsonValue(nextRequest.payload as JsonValue),
          revision: nextDraftRevision,
          updatedAt,
        },
        review: null,
        prepare: this.#createPreparingState(nextDraftRevision, updatedAt),
      };

      this.#sessions.set(current.approvalId, nextSession);
      return nextSession;
    });

    return await this.#runPrepare(edited);
  }

  async approveTransaction(
    input: ApproveTransactionApprovalSessionInput,
  ): Promise<ApproveTransactionApprovalSessionResult> {
    return await this.#withSessionLock(input.approvalId, async () => {
      const session = this.#sessions.get(input.approvalId);
      if (!session) {
        return this.#buildApprovalStaleResult(null);
      }

      if (session.prepare.prepareId !== input.expectedPrepareId) {
        return this.#buildApprovalStaleResult(session);
      }
      this.#requireReadySession(session);

      const proposal = this.#requireProposal(session.namespace);
      const approvalResourceKey =
        proposal.deriveApprovalResourceKey?.(this.#buildApprovalResourceContext(session)) ?? null;

      return await this.#withApprovalResourceLock(approvalResourceKey, async () => {
        const current = this.#loadOpenSessionOrThrow(input.approvalId);
        if (current.prepare.prepareId !== input.expectedPrepareId) {
          return this.#buildApprovalStaleResult(current);
        }
        const readySession = this.#requireReadySession(current);

        let finalized: TransactionApprovalFinalizeResult;
        try {
          finalized = await this.#finalizeApproval(readySession, proposal);
        } catch (error) {
          return this.#failCurrentApprovalAfterFinalizeException(input, error);
        }

        const currentAfterFinalize = this.#loadOpenSessionOrThrow(input.approvalId);
        if (currentAfterFinalize.prepare.prepareId !== input.expectedPrepareId) {
          return this.#buildApprovalStaleResult(currentAfterFinalize);
        }

        if (finalized.status === "approval_stale") {
          const refreshed = await this.#restartPrepareRun(currentAfterFinalize);
          return {
            status: "approval_stale",
            session: refreshed,
            stale: finalized.stale,
          };
        }

        if (finalized.status === "blocked" || finalized.status === "failed") {
          let updated: TransactionApprovalSession;
          try {
            updated = this.#settleFinalizationReview(currentAfterFinalize, proposal, finalized);
          } catch (error) {
            return this.#failCurrentApprovalAfterFinalizeException(input, error);
          }

          this.#sessions.set(currentAfterFinalize.approvalId, updated);
          if (finalized.status === "blocked") {
            return {
              status: "blocked",
              session: structuredClone(updated),
              blocker: finalized.blocker,
            };
          }

          return {
            status: "failed",
            session: structuredClone(updated),
            error: finalized.error,
          };
        }

        const aggregate = await this.#transactions.createApprovedTransaction({
          namespace: currentAfterFinalize.namespace,
          chainRef: currentAfterFinalize.chainRef,
          origin: currentAfterFinalize.origin,
          source: currentAfterFinalize.source,
          requestId: currentAfterFinalize.requestId,
          accountKey: currentAfterFinalize.accountKey,
          request: {
            payload: cloneJsonValue(currentAfterFinalize.draft.payload),
          },
          replacement: currentAfterFinalize.replacement,
          approvalId: currentAfterFinalize.approvalId,
          approvedAt: null,
          approvedRequestPayload: cloneJsonValue(finalized.approvedPayload as JsonValue),
          submissionId: null,
          conflictKey: finalized.conflictKey,
        });

        this.#sessions.delete(currentAfterFinalize.approvalId);
        return {
          status: "approved",
          aggregate,
        };
      });
    });
  }

  discardSession(input: ResolveTransactionApprovalSessionInput): TransactionApprovalSession | null {
    return this.discardSessionByApprovalId(input.approvalId);
  }

  #buildDraftRequest(session: TransactionApprovalSession): TransactionRequest {
    return {
      namespace: session.namespace,
      chainRef: session.chainRef,
      payload: cloneJsonValue(session.draft.payload) as Record<string, unknown>,
    };
  }

  #buildApprovalResourceContext(session: TransactionApprovalSession) {
    return {
      transactionId: session.approvalId,
      namespace: session.namespace,
      chainRef: session.chainRef,
      origin: session.origin,
      accountKey: session.accountKey,
      from: session.from,
    };
  }

  #startPrepareRun(session: TransactionApprovalSession): TransactionApprovalSession {
    const updatedAt = this.#now();
    const next: TransactionApprovalSession = {
      ...session,
      review: null,
      prepare: this.#createPreparingState(session.draft.revision, updatedAt),
    };
    this.#sessions.set(session.approvalId, next);
    return next;
  }

  async #restartPrepareRun(session: TransactionApprovalSession): Promise<TransactionApprovalSession> {
    const restarted = this.#startPrepareRun(session);
    return await this.#runPrepare(restarted);
  }

  async #runPrepare(started: TransactionApprovalSession): Promise<TransactionApprovalSession> {
    try {
      const proposal = this.#requireProposal(started.namespace);
      const request = this.#buildDraftRequest(started);
      const prepareContext = {
        transactionId: started.approvalId,
        namespace: started.namespace,
        chainRef: started.chainRef,
        origin: started.origin,
        from: started.from,
        request,
      };

      this.#namespaces.require(started.namespace).request?.validateRequest?.(prepareContext);
      const result = await proposal.prepare(prepareContext);

      const current = this.#sessions.get(started.approvalId);
      if (!current) {
        throw new TransactionApprovalSessionNotFoundError(started.approvalId);
      }
      if (!this.#isLatestPrepareRun(current, started)) {
        return structuredClone(current);
      }

      const settled = this.#buildPreparedSession(current, proposal, result);
      this.#sessions.set(current.approvalId, settled);
      return structuredClone(settled);
    } catch (error) {
      const current = this.#sessions.get(started.approvalId);
      if (!current) {
        throw new TransactionApprovalSessionNotFoundError(started.approvalId);
      }
      if (!this.#isLatestPrepareRun(current, started)) {
        return structuredClone(current);
      }

      const failed = this.#buildFailedSession(current, null, this.#normalizePrepareError(error), this.#now());
      this.#sessions.set(current.approvalId, failed);
      return structuredClone(failed);
    }
  }

  #buildPreparedSession(
    session: TransactionApprovalSession,
    proposal: NamespaceTransactionProposal,
    result: TransactionPrepareResult,
  ): TransactionApprovalSession {
    const reviewSnapshot =
      result.status === "ready"
        ? ((result.reviewSnapshot ?? result.prepared) as JsonValue)
        : ((result.reviewSnapshot ?? null) as JsonValue | null);
    const review = this.#buildReviewDetails(session, proposal, reviewSnapshot);
    const updatedAt = this.#now();

    if (result.status === "ready") {
      return this.#buildReadySession(session, review, result.prepared as JsonValue, updatedAt);
    }

    if (result.status === "blocked") {
      return this.#buildBlockedSession(session, review, result.blocker, updatedAt);
    }

    return this.#buildFailedSession(session, review, result.error, updatedAt);
  }

  #settleFinalizationReview(
    session: TransactionApprovalSession,
    proposal: NamespaceTransactionProposal,
    result: FinalizationReviewResult,
  ): TransactionApprovalSession {
    const updatedAt = this.#now();
    const review = this.#buildReviewDetails(session, proposal, (result.reviewSnapshot ?? null) as JsonValue | null);

    if (result.status === "blocked") {
      return this.#buildBlockedSession(session, review, result.blocker, updatedAt);
    }

    return this.#buildFailedSession(session, review, result.error, updatedAt);
  }

  async #finalizeApproval(
    session: ReadyApprovalSession,
    proposal: NamespaceTransactionProposal,
  ): Promise<TransactionApprovalFinalizeResult> {
    if (!proposal.finalizeApproval) {
      const approvedPayload = cloneJsonValue(session.prepare.approvedPayload);
      return {
        status: "approved",
        approvedPayload: approvedPayload as Record<string, unknown>,
        conflictKey:
          proposal.deriveConflictKey?.({
            transactionId: session.approvalId,
            namespace: session.namespace,
            chainRef: session.chainRef,
            origin: session.origin,
            accountKey: session.accountKey,
            from: session.from,
            request: this.#buildDraftRequest(session),
            approvedPayload: approvedPayload as Record<string, unknown>,
          }) ?? null,
        expiresAt: session.prepare.expiresAt,
      };
    }

    return await proposal.finalizeApproval({
      transactionId: session.approvalId,
      approvalId: session.approvalId,
      namespace: session.namespace,
      chainRef: session.chainRef,
      origin: session.origin,
      accountKey: session.accountKey,
      from: session.from,
      request: this.#buildDraftRequest(session),
      approvedPayload: cloneJsonValue(session.prepare.approvedPayload as JsonValue) as Record<string, unknown>,
      replacement: session.replacement,
      localActiveTransactions: await this.#listLocalActiveApprovals(session),
    });
  }

  #buildReviewDetails(
    session: TransactionApprovalSession,
    proposal: NamespaceTransactionProposal,
    reviewSnapshot: JsonValue | null,
  ) {
    if (reviewSnapshot === null) {
      return null;
    }

    if (!proposal.buildReview) {
      return null;
    }

    return (
      proposal.buildReview({
        transactionId: session.approvalId,
        namespace: session.namespace,
        chainRef: session.chainRef,
        origin: session.origin,
        from: session.from,
        request: this.#buildDraftRequest(session),
        reviewSnapshot: cloneJsonValue(reviewSnapshot) as Record<string, unknown>,
      }) ?? null
    );
  }

  #buildApprovalStaleResult(session: TransactionApprovalSession | null): ApproveTransactionApprovalSessionResult {
    return {
      status: "approval_stale",
      session: session ? structuredClone(session) : null,
      stale: {
        reason: "transaction.approval_stale",
        message: "Transaction approval is stale and must be refreshed.",
      },
    };
  }

  #failCurrentApprovalAfterFinalizeException(
    input: ApproveTransactionApprovalSessionInput,
    error: unknown,
  ): ApproveTransactionApprovalSessionResult {
    const current = this.#sessions.get(input.approvalId);
    if (!current) {
      return this.#buildApprovalStaleResult(null);
    }

    if (current.prepare.prepareId !== input.expectedPrepareId) {
      return this.#buildApprovalStaleResult(current);
    }

    const normalizedError = this.#normalizeFinalizeError(error);
    const failed = this.#buildFailedSession(current, null, normalizedError, this.#now());
    this.#sessions.set(current.approvalId, failed);
    return {
      status: "failed",
      session: structuredClone(failed),
      error: normalizedError,
    };
  }

  async #listLocalActiveApprovals(session: TransactionApprovalSession): Promise<readonly ActiveLocalApproval[]> {
    const [submittingRecords, submittedRecords] = await Promise.all([
      this.#transactions.listTransactionHistory({
        namespace: session.namespace,
        chainRef: session.chainRef,
        accountKey: session.accountKey,
        status: "submitting",
      }),
      this.#transactions.listTransactionHistory({
        namespace: session.namespace,
        chainRef: session.chainRef,
        accountKey: session.accountKey,
        status: "submitted",
      }),
    ]);

    const activeApprovals: ActiveLocalApproval[] = [];

    for (const record of [...submittingRecords, ...submittedRecords]) {
      const approvedPayload = record.approvedRequest?.payload;
      if (!approvedPayload || typeof approvedPayload !== "object" || Array.isArray(approvedPayload)) {
        throw new TransactionApprovalSessionInvariantError(
          record.id,
          `Active transaction "${record.id}" is missing an approved payload.`,
        );
      }

      activeApprovals.push({
        transactionId: record.id,
        status: record.status as "submitting" | "submitted",
        approvedPayload: cloneJsonValue(approvedPayload) as Record<string, unknown>,
        conflictKey: structuredClone(record.conflictKey),
      });
    }

    return activeApprovals;
  }

  #createPreparingState(draftRevision: number, updatedAt: number) {
    return {
      status: "preparing" as const,
      draftRevision,
      prepareId: this.#createId(),
      updatedAt,
    };
  }

  #buildReadySession(
    session: TransactionApprovalSession,
    review: TransactionApprovalSession["review"],
    approvedPayload: JsonValue,
    updatedAt: number,
  ): TransactionApprovalSession {
    return {
      ...session,
      review,
      prepare: {
        status: "ready",
        draftRevision: session.draft.revision,
        prepareId: session.prepare.prepareId,
        approvedPayload: cloneJsonValue(approvedPayload),
        preparedAt: updatedAt,
        expiresAt: null,
        updatedAt,
      },
    };
  }

  #buildBlockedSession(
    session: TransactionApprovalSession,
    review: TransactionApprovalSession["review"],
    blocker: Extract<FinalizationReviewResult | TransactionPrepareResult, { status: "blocked" }>["blocker"],
    updatedAt: number,
  ): TransactionApprovalSession {
    return {
      ...session,
      review,
      prepare: {
        status: "blocked",
        draftRevision: session.draft.revision,
        prepareId: session.prepare.prepareId,
        blocker,
        approvedPayload: null,
        expiresAt: null,
        updatedAt,
      },
    };
  }

  #buildFailedSession(
    session: TransactionApprovalSession,
    review: TransactionApprovalSession["review"],
    error: TransactionProposalError,
    updatedAt: number,
  ): TransactionApprovalSession {
    return {
      ...session,
      review,
      prepare: {
        status: "failed",
        draftRevision: session.draft.revision,
        prepareId: session.prepare.prepareId,
        error,
        updatedAt,
      },
    };
  }

  #normalizePrepareError(error: unknown): TransactionProposalError {
    return this.#normalizeProposalError(error, "transaction.prepare.unhandled_error");
  }

  #normalizeFinalizeError(error: unknown): TransactionProposalError {
    return this.#normalizeProposalError(error, "transaction.approval.finalize_failed");
  }

  #normalizeProposalError(error: unknown, fallbackReason: string): TransactionProposalError {
    if (typeof error === "object" && error !== null && "reason" in error && "message" in error) {
      const reason = (error as { reason: unknown }).reason;
      const message = (error as { message: unknown }).message;
      if (typeof reason === "string" && typeof message === "string") {
        const data = "data" in error ? (error as { data?: unknown }).data : undefined;
        return {
          reason,
          message,
          ...(data !== undefined ? { data } : {}),
        };
      }
    }

    if (error instanceof Error) {
      return {
        reason: fallbackReason,
        message: error.message,
        data: { name: error.name },
      };
    }

    return {
      reason: fallbackReason,
      message: String(error),
    };
  }

  #requireProposal(namespace: string): NamespaceTransactionProposal {
    const proposal = this.#namespaces.require(namespace).proposal;
    if (!proposal) {
      const error = new Error(`No namespace transaction registered for namespace ${namespace}`);
      error.name = "NamespaceTransactionMissingError";
      throw error;
    }
    return proposal;
  }

  #isLatestPrepareRun(current: TransactionApprovalSession, started: TransactionApprovalSession): boolean {
    return (
      current.approvalId === started.approvalId &&
      current.draft.revision === started.draft.revision &&
      current.prepare.status === "preparing" &&
      current.prepare.prepareId === started.prepare.prepareId
    );
  }

  #loadOpenSessionOrThrow(approvalId: string): TransactionApprovalSession {
    const session = this.#sessions.get(approvalId);
    if (!session) {
      throw new TransactionApprovalSessionNotFoundError(approvalId);
    }
    return session;
  }

  #requireReadySession(session: TransactionApprovalSession): ReadyApprovalSession {
    if (session.prepare.status !== "ready") {
      throw new TransactionApprovalSessionInvariantError(
        session.approvalId,
        `Transaction approval "${session.approvalId}" is not ready; current prepare status is "${session.prepare.status}".`,
      );
    }
    return session as ReadyApprovalSession;
  }

  async #withSessionLock<T>(approvalId: string, run: () => Promise<T>): Promise<T> {
    return await this.#sessionLock.withToken(approvalId, run);
  }

  async #withApprovalResourceLock<T>(resourceKey: TransactionApprovalResourceKey | null, run: () => Promise<T>) {
    return await this.#resourceLock.withKey(resourceKey, run);
  }
}
