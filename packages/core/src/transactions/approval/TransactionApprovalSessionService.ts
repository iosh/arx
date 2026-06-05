import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionAggregate } from "../aggregate/index.js";
import { type JsonValue, TransactionAggregateNotFoundError } from "../aggregate/index.js";
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
import { createMissingNamespaceTransactionError } from "../utils.js";
import {
  TransactionApprovalSessionConflictError,
  TransactionApprovalSessionInvariantError,
  TransactionApprovalSessionNotFoundError,
} from "./errors.js";
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
  transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "approveTransaction"
    | "rejectTransaction"
    | "cancelTransaction"
    | "expireTransaction"
    | "listTransactionHistory"
  >;
  namespaces: Pick<NamespaceTransactions, "require">;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
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
  #transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "approveTransaction"
    | "rejectTransaction"
    | "cancelTransaction"
    | "expireTransaction"
    | "listTransactionHistory"
  >;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #resourceLock: TransactionResourceLock;
  #now: () => number;
  #createId: () => string;
  #sessions = new Map<string, TransactionApprovalSession>();
  #sessionLock = new TransactionResourceLock();

  constructor(deps: TransactionApprovalSessionServiceDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountCodecs = deps.accountCodecs;
    this.#resourceLock = deps.resourceLock;
    this.#now = deps.now ?? Date.now;
    this.#createId = deps.createId ?? crypto.randomUUID;
  }

  getSession(transactionId: string): TransactionApprovalSession | null {
    const session = this.#sessions.get(transactionId);
    return session ? structuredClone(session) : null;
  }

  getSessionByApprovalId(approvalId: string): TransactionApprovalSession | null {
    const session = this.#findOpenSessionByApprovalId(approvalId);
    return session ? structuredClone(session) : null;
  }

  discardSessionByTransactionId(transactionId: string): TransactionApprovalSession | null {
    const session = this.#sessions.get(transactionId);
    if (!session) {
      return null;
    }

    this.#sessions.delete(transactionId);
    return structuredClone(session);
  }

  async openSession(input: OpenTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const opened = await this.#withSessionLock(input.transactionId, async () => {
      const approvalSession = this.#findOpenSessionByApprovalId(input.approvalId);
      if (approvalSession && approvalSession.transactionId !== input.transactionId) {
        throw new TransactionApprovalSessionInvariantError(
          input.transactionId,
          `Approval "${input.approvalId}" already owns transaction "${approvalSession.transactionId}".`,
        );
      }

      const existing = this.#sessions.get(input.transactionId);
      if (existing) {
        this.#assertApprovalOwnsSession(existing, input.approvalId);
        return {
          shouldPrepare: false as const,
          session: structuredClone(existing),
        };
      }

      const aggregate = await this.#loadAggregateOrThrow(input.transactionId);
      if (aggregate.record.status !== "awaiting_approval") {
        throw new TransactionApprovalSessionInvariantError(
          aggregate.record.id,
          `Transaction "${aggregate.record.id}" is no longer awaiting approval; current status is "${aggregate.record.status}".`,
        );
      }

      const openedAt = this.#now();
      const session: TransactionApprovalSession = {
        transactionId: aggregate.record.id,
        approvalId: input.approvalId,
        namespace: aggregate.record.namespace,
        chainRef: aggregate.record.chainRef,
        origin: aggregate.record.origin,
        accountKey: aggregate.record.accountKey,
        from: this.#accountCodecs.toCanonicalAddressFromAccountKey({
          accountKey: aggregate.record.accountKey,
        }),
        draft: {
          payload: cloneJsonValue(aggregate.record.request.payload),
          revision: 0,
          updatedAt: openedAt,
        },
        prepare: this.#createPreparingState(0, openedAt),
        review: null,
      };

      this.#sessions.set(input.transactionId, session);
      return {
        shouldPrepare: true as const,
        session,
      };
    });

    return opened.shouldPrepare ? await this.#runPrepare(opened.session) : opened.session;
  }

  async prepareSession(input: PrepareTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const restarted = await this.#withSessionLock(input.transactionId, async () => {
      const current = this.#loadOpenSessionOrThrow(input.transactionId);
      this.#assertApprovalOwnsSession(current, input.approvalId);
      return this.#startPrepareRun(current);
    });

    return await this.#runPrepare(restarted);
  }

  async applyDraftEdit(input: EditTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const edited = await this.#withSessionLock(input.transactionId, async () => {
      const current = this.#loadOpenSessionOrThrow(input.transactionId);
      this.#assertApprovalOwnsSession(current, input.approvalId);

      const proposal = this.#requireProposal(current.namespace);
      if (!proposal.applyDraftEdit) {
        throw new TransactionApprovalSessionInvariantError(
          current.transactionId,
          `Namespace "${current.namespace}" does not support transaction draft edits.`,
        );
      }

      const nextRequest = proposal.applyDraftEdit({
        transactionId: current.transactionId,
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

      this.#sessions.set(current.transactionId, nextSession);
      return nextSession;
    });

    return await this.#runPrepare(edited);
  }

  async approveTransaction(
    input: ApproveTransactionApprovalSessionInput,
  ): Promise<ApproveTransactionApprovalSessionResult> {
    return await this.#withSessionLock(input.transactionId, async () => {
      const session = this.#sessions.get(input.transactionId);
      if (!session) {
        await this.#loadAggregateOrThrow(input.transactionId);
        return this.#buildApprovalStaleResult(null);
      }

      this.#assertApprovalOwnsSession(session, input.approvalId);
      if (session.prepare.prepareId !== input.expectedPrepareId) {
        return this.#buildApprovalStaleResult(session);
      }
      this.#requireReadySession(session);

      const aggregate = await this.#loadAggregateOrThrow(session.transactionId);
      if (aggregate.record.status !== "awaiting_approval") {
        throw new TransactionApprovalSessionInvariantError(
          aggregate.record.id,
          `Transaction "${aggregate.record.id}" is no longer awaiting approval; current status is "${aggregate.record.status}".`,
        );
      }

      const proposal = this.#requireProposal(session.namespace);
      const approvalResourceKey =
        proposal.deriveApprovalResourceKey?.(this.#buildApprovalResourceContext(session)) ?? null;

      return await this.#withApprovalResourceLock(approvalResourceKey, async () => {
        const current = this.#loadOpenSessionOrThrow(input.transactionId);
        this.#assertApprovalOwnsSession(current, input.approvalId);
        if (current.prepare.prepareId !== input.expectedPrepareId) {
          return this.#buildApprovalStaleResult(current);
        }
        const readySession = this.#requireReadySession(current);

        const latestAggregate = await this.#loadAggregateOrThrow(current.transactionId);
        if (latestAggregate.record.status !== "awaiting_approval") {
          throw new TransactionApprovalSessionInvariantError(
            latestAggregate.record.id,
            `Transaction "${latestAggregate.record.id}" is no longer awaiting approval; current status is "${latestAggregate.record.status}".`,
          );
        }

        let finalized: TransactionApprovalFinalizeResult;
        try {
          finalized = await this.#finalizeApproval(
            readySession,
            proposal,
            latestAggregate.record.replacesTransactionId,
            latestAggregate.record.replacementType,
          );
        } catch (error) {
          return await this.#failCurrentApprovalAfterFinalizeException(input, error);
        }

        const currentAfterFinalize = this.#loadOpenSessionOrThrow(input.transactionId);
        this.#assertApprovalOwnsSession(currentAfterFinalize, input.approvalId);
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
            return await this.#failCurrentApprovalAfterFinalizeException(input, error);
          }

          this.#sessions.set(currentAfterFinalize.transactionId, updated);
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

        const next = await this.#transactions.approveTransaction({
          transactionId: currentAfterFinalize.transactionId,
          approvalId: currentAfterFinalize.approvalId,
          approvedAt: null,
          approvedRequestPayload: cloneJsonValue(finalized.approvedPayload as JsonValue),
          submissionId: null,
          conflictKey: finalized.conflictKey,
        });

        this.#sessions.delete(currentAfterFinalize.transactionId);
        return {
          status: "approved",
          aggregate: next,
        };
      });
    });
  }

  async rejectTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    return await this.#withSessionLock(input.transactionId, async () => {
      this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
      const next = await this.#transactions.rejectTransaction({
        transactionId: input.transactionId,
        reason: input.reason ?? null,
      });
      this.#sessions.delete(input.transactionId);
      return next;
    });
  }

  async cancelTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    return await this.#withSessionLock(input.transactionId, async () => {
      this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
      const next = await this.#transactions.cancelTransaction({
        transactionId: input.transactionId,
        reason: input.reason ?? null,
      });
      this.#sessions.delete(input.transactionId);
      return next;
    });
  }

  async expireTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    return await this.#withSessionLock(input.transactionId, async () => {
      this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
      const next = await this.#transactions.expireTransaction({
        transactionId: input.transactionId,
        reason: input.reason ?? null,
      });
      this.#sessions.delete(input.transactionId);
      return next;
    });
  }

  #findOpenSessionByApprovalId(approvalId: string): TransactionApprovalSession | null {
    for (const session of this.#sessions.values()) {
      if (session.approvalId === approvalId) {
        return session;
      }
    }

    return null;
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
      transactionId: session.transactionId,
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
    this.#sessions.set(session.transactionId, next);
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
        transactionId: started.transactionId,
        namespace: started.namespace,
        chainRef: started.chainRef,
        origin: started.origin,
        from: started.from,
        request,
      };

      this.#namespaces.require(started.namespace).request?.validateRequest?.(prepareContext);
      const result = await proposal.prepare(prepareContext);

      const current = this.#sessions.get(started.transactionId);
      if (!current) {
        throw new TransactionApprovalSessionNotFoundError(started.transactionId);
      }
      if (!this.#isLatestPrepareRun(current, started)) {
        return structuredClone(current);
      }

      const settled = this.#buildPreparedSession(current, proposal, result);
      this.#sessions.set(current.transactionId, settled);
      return structuredClone(settled);
    } catch (error) {
      const current = this.#sessions.get(started.transactionId);
      if (!current) {
        throw new TransactionApprovalSessionNotFoundError(started.transactionId);
      }
      if (!this.#isLatestPrepareRun(current, started)) {
        return structuredClone(current);
      }

      const failed = this.#buildFailedSession(current, null, this.#normalizePrepareError(error), this.#now());
      this.#sessions.set(current.transactionId, failed);
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
    replacesTransactionId: string | null,
    replacementType: TransactionAggregate["record"]["replacementType"],
  ): Promise<TransactionApprovalFinalizeResult> {
    if (!proposal.finalizeApproval) {
      const approvedPayload = cloneJsonValue(session.prepare.approvedPayload);
      return {
        status: "approved",
        approvedPayload: approvedPayload as Record<string, unknown>,
        conflictKey:
          proposal.deriveConflictKey?.({
            transactionId: session.transactionId,
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
      transactionId: session.transactionId,
      approvalId: session.approvalId,
      namespace: session.namespace,
      chainRef: session.chainRef,
      origin: session.origin,
      accountKey: session.accountKey,
      from: session.from,
      request: this.#buildDraftRequest(session),
      approvedPayload: cloneJsonValue(session.prepare.approvedPayload as JsonValue) as Record<string, unknown>,
      replacement:
        replacesTransactionId === null
          ? null
          : {
              transactionId: replacesTransactionId,
              type: replacementType,
            },
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
        transactionId: session.transactionId,
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

  async #failCurrentApprovalAfterFinalizeException(
    input: ApproveTransactionApprovalSessionInput,
    error: unknown,
  ): Promise<ApproveTransactionApprovalSessionResult> {
    const current = this.#sessions.get(input.transactionId);
    if (!current) {
      await this.#loadAggregateOrThrow(input.transactionId);
      return this.#buildApprovalStaleResult(null);
    }

    this.#assertApprovalOwnsSession(current, input.approvalId);
    if (current.prepare.prepareId !== input.expectedPrepareId) {
      return this.#buildApprovalStaleResult(current);
    }

    const normalizedError = this.#normalizeFinalizeError(error);
    const failed = this.#buildFailedSession(current, null, normalizedError, this.#now());
    this.#sessions.set(current.transactionId, failed);
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
      if (record.id === session.transactionId) {
        continue;
      }

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
      throw createMissingNamespaceTransactionError(namespace);
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

  #assertApprovalOwnsSession(session: TransactionApprovalSession, approvalId: string): void {
    if (session.approvalId !== approvalId) {
      throw new TransactionApprovalSessionConflictError(
        session.transactionId,
        `Approval "${approvalId}" does not own transaction approval session "${session.transactionId}".`,
      );
    }
  }

  #assertApprovalOwnsOpenSession(transactionId: string, approvalId: string): void {
    const session = this.#sessions.get(transactionId);
    if (!session) return;
    this.#assertApprovalOwnsSession(session, approvalId);
  }

  async #loadAggregateOrThrow(transactionId: string): Promise<TransactionAggregate> {
    const aggregate = await this.#transactions.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }
    return aggregate;
  }

  #loadOpenSessionOrThrow(transactionId: string): TransactionApprovalSession {
    const session = this.#sessions.get(transactionId);
    if (!session) {
      throw new TransactionApprovalSessionNotFoundError(transactionId);
    }
    return session;
  }

  #requireReadySession(session: TransactionApprovalSession): ReadyApprovalSession {
    if (session.prepare.status !== "ready") {
      throw new TransactionApprovalSessionInvariantError(
        session.transactionId,
        `Transaction "${session.transactionId}" is not ready for approval; current prepare status is "${session.prepare.status}".`,
      );
    }
    return session as ReadyApprovalSession;
  }

  async #withSessionLock<T>(transactionId: string, run: () => Promise<T>): Promise<T> {
    return await this.#sessionLock.withToken(transactionId, run);
  }

  async #withApprovalResourceLock<T>(resourceKey: TransactionApprovalResourceKey | null, run: () => Promise<T>) {
    return await this.#resourceLock.withKey(resourceKey, run);
  }
}
