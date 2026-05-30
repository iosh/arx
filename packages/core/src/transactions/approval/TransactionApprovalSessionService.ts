import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionAggregate } from "../aggregate/index.js";
import type { TransactionAggregateStore } from "../aggregate/TransactionAggregateStore.js";
import { type JsonValue, TransactionAggregateNotFoundError } from "../aggregate/index.js";
import { cloneJsonValue } from "../aggregate/json.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type {
  NamespaceTransactionProposal,
  TransactionPrepareResult,
  TransactionProposalError,
} from "../namespace/types.js";
import type { TransactionRequest } from "../types.js";
import { createMissingNamespaceTransactionError } from "../utils.js";
import {
  TransactionApprovalSessionConflictError,
  TransactionApprovalSessionInvariantError,
  TransactionApprovalSessionNotFoundError,
} from "./errors.js";
import type {
  ApproveTransactionApprovalSessionInput,
  EditTransactionApprovalSessionInput,
  OpenTransactionApprovalSessionInput,
  PrepareTransactionApprovalSessionInput,
  ResolveTransactionApprovalSessionInput,
  TransactionApprovalSession,
} from "./types.js";

type TransactionApprovalSessionServiceDeps = {
  transactions: Pick<
    TransactionAggregateStore,
    "loadTransactionAggregate" | "approveTransaction" | "rejectTransaction" | "cancelTransaction" | "expireTransaction"
  >;
  namespaces: Pick<NamespaceTransactions, "require">;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  now?: () => number;
  createId?: () => string;
};

export class TransactionApprovalSessionService {
  #transactions: Pick<
    TransactionAggregateStore,
    "loadTransactionAggregate" | "approveTransaction" | "rejectTransaction" | "cancelTransaction" | "expireTransaction"
  >;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #now: () => number;
  #createId: () => string;
  #sessions = new Map<string, TransactionApprovalSession>();

  constructor(deps: TransactionApprovalSessionServiceDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountCodecs = deps.accountCodecs;
    this.#now = deps.now ?? Date.now;
    this.#createId = deps.createId ?? crypto.randomUUID;
  }

  getSession(transactionId: string): TransactionApprovalSession | null {
    const session = this.#sessions.get(transactionId);
    return session ? structuredClone(session) : null;
  }

  async openSession(input: OpenTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const existing = this.#sessions.get(input.transactionId);
    if (existing) {
      this.#assertApprovalOwnsSession(existing, input.approvalId);
      return structuredClone(existing);
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
      prepare: {
        status: "preparing",
        draftRevision: 0,
        prepareId: this.#createId(),
        updatedAt: openedAt,
      },
    };

    this.#sessions.set(input.transactionId, session);
    return await this.#runPrepare(session);
  }

  async prepareSession(input: PrepareTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const current = this.#loadOpenSessionOrThrow(input.transactionId);
    this.#assertApprovalOwnsSession(current, input.approvalId);
    const next = this.#startPrepareRun(current);
    return await this.#runPrepare(next);
  }

  async applyDraftEdit(input: EditTransactionApprovalSessionInput): Promise<TransactionApprovalSession> {
    const current = this.#loadOpenSessionOrThrow(input.transactionId);
    this.#assertApprovalOwnsSession(current, input.approvalId);

    const namespaceTransaction = this.#namespaces.require(current.namespace);
    if (!namespaceTransaction.proposal) {
      throw createMissingNamespaceTransactionError(current.namespace);
    }
    if (!namespaceTransaction.proposal.applyDraftEdit) {
      throw new TransactionApprovalSessionInvariantError(
        current.transactionId,
        `Namespace "${current.namespace}" does not support transaction draft edits.`,
      );
    }

    const nextRequest = namespaceTransaction.proposal.applyDraftEdit({
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
    const edited: TransactionApprovalSession = {
      ...current,
      draft: {
        payload: cloneJsonValue(nextRequest.payload as JsonValue),
        revision: nextDraftRevision,
        updatedAt,
      },
      prepare: {
        status: "preparing",
        draftRevision: nextDraftRevision,
        prepareId: this.#createId(),
        updatedAt,
      },
    };

    this.#sessions.set(current.transactionId, edited);
    return await this.#runPrepare(edited);
  }

  async approveTransaction(input: ApproveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    const session = this.#loadOpenSessionOrThrow(input.transactionId);
    this.#assertApprovalOwnsSession(session, input.approvalId);
    if (session.prepare.status !== "ready") {
      throw new TransactionApprovalSessionInvariantError(
        session.transactionId,
        `Transaction "${session.transactionId}" is not ready for approval; current prepare status is "${session.prepare.status}".`,
      );
    }

    const aggregate = await this.#loadAggregateOrThrow(session.transactionId);
    if (aggregate.record.status !== "awaiting_approval") {
      throw new TransactionApprovalSessionInvariantError(
        aggregate.record.id,
        `Transaction "${aggregate.record.id}" is no longer awaiting approval; current status is "${aggregate.record.status}".`,
      );
    }

    const approvedPayload = cloneJsonValue(session.prepare.approvedPayload);
    const namespaceTransaction = this.#namespaces.require(session.namespace);
    const proposal = namespaceTransaction.proposal;
    if (!proposal) {
      throw createMissingNamespaceTransactionError(session.namespace);
    }

    const next = await this.#transactions.approveTransaction({
      transactionId: session.transactionId,
      approvalId: session.approvalId,
      approvedAt: null,
      approvedRequestPayload: approvedPayload,
      submissionId: null,
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
    });

    this.#sessions.delete(session.transactionId);
    return next;
  }

  async rejectTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
    const next = await this.#transactions.rejectTransaction({
      transactionId: input.transactionId,
      reason: input.reason ?? null,
    });
    this.#sessions.delete(input.transactionId);
    return next;
  }

  async cancelTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
    const next = await this.#transactions.cancelTransaction({
      transactionId: input.transactionId,
      reason: input.reason ?? null,
    });
    this.#sessions.delete(input.transactionId);
    return next;
  }

  async expireTransaction(input: ResolveTransactionApprovalSessionInput): Promise<TransactionAggregate> {
    this.#assertApprovalOwnsOpenSession(input.transactionId, input.approvalId);
    const next = await this.#transactions.expireTransaction({
      transactionId: input.transactionId,
      reason: input.reason ?? null,
    });
    this.#sessions.delete(input.transactionId);
    return next;
  }

  #buildDraftRequest(session: TransactionApprovalSession): TransactionRequest {
    return {
      namespace: session.namespace,
      chainRef: session.chainRef,
      payload: cloneJsonValue(session.draft.payload) as Record<string, unknown>,
    };
  }

  #startPrepareRun(session: TransactionApprovalSession): TransactionApprovalSession {
    const updatedAt = this.#now();
    const next: TransactionApprovalSession = {
      ...session,
      prepare: {
        status: "preparing",
        draftRevision: session.draft.revision,
        prepareId: this.#createId(),
        updatedAt,
      },
    };
    this.#sessions.set(session.transactionId, next);
    return next;
  }

  async #runPrepare(started: TransactionApprovalSession): Promise<TransactionApprovalSession> {
    try {
      const namespaceTransaction = this.#namespaces.require(started.namespace);
      const proposal = namespaceTransaction.proposal;
      if (!proposal) {
        throw createMissingNamespaceTransactionError(started.namespace);
      }

      const request = this.#buildDraftRequest(started);
      const prepareContext = {
        transactionId: started.transactionId,
        namespace: started.namespace,
        chainRef: started.chainRef,
        origin: started.origin,
        from: started.from,
        request,
      };

      namespaceTransaction.request?.validateRequest?.(prepareContext);
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

      let prepareError: TransactionProposalError;
      if (typeof error === "object" && error !== null && "reason" in error && "message" in error) {
        const reason = (error as { reason: unknown }).reason;
        const message = (error as { message: unknown }).message;
        if (typeof reason === "string" && typeof message === "string") {
          const data = "data" in error ? (error as { data?: unknown }).data : undefined;
          prepareError = {
            reason,
            message,
            ...(data !== undefined ? { data } : {}),
          };
        } else if (error instanceof Error) {
          prepareError = {
            reason: "transaction.prepare.unhandled_error",
            message: error.message,
            data: { name: error.name },
          };
        } else {
          prepareError = {
            reason: "transaction.prepare.unhandled_error",
            message: String(error),
          };
        }
      } else if (error instanceof Error) {
        prepareError = {
          reason: "transaction.prepare.unhandled_error",
          message: error.message,
          data: { name: error.name },
        };
      } else {
        prepareError = {
          reason: "transaction.prepare.unhandled_error",
          message: String(error),
        };
      }

      const failed: TransactionApprovalSession = {
        ...current,
        prepare: {
          status: "failed",
          draftRevision: started.draft.revision,
          prepareId: started.prepare.prepareId,
          error: prepareError,
          updatedAt: this.#now(),
        },
      };
      this.#sessions.set(current.transactionId, failed);
      return structuredClone(failed);
    }
  }

  #buildPreparedSession(
    session: TransactionApprovalSession,
    proposal: NamespaceTransactionProposal,
    result: TransactionPrepareResult,
  ): TransactionApprovalSession {
    const updatedAt = this.#now();
    const draftRevision = session.draft.revision;
    const prepareId = session.prepare.prepareId;
    const reviewSnapshot =
      result.status === "ready"
        ? cloneJsonValue(result.prepared as JsonValue)
        : result.reviewSnapshot === undefined || result.reviewSnapshot === null
          ? null
          : cloneJsonValue(result.reviewSnapshot as JsonValue);
    const review =
      reviewSnapshot === null
        ? null
        : (proposal.buildReview?.({
            transactionId: session.transactionId,
            namespace: session.namespace,
            chainRef: session.chainRef,
            origin: session.origin,
            from: session.from,
            request: this.#buildDraftRequest(session),
            reviewSnapshot: reviewSnapshot as Record<string, unknown>,
          }) ?? null);

    if (result.status === "ready") {
      return {
        ...session,
        prepare: {
          status: "ready",
          draftRevision,
          prepareId,
          approvedPayload: cloneJsonValue(result.prepared as JsonValue),
          review,
          preparedAt: updatedAt,
          expiresAt: null,
          updatedAt,
        },
      };
    }

    if (result.status === "blocked") {
      return {
        ...session,
        prepare: {
          status: "blocked",
          draftRevision,
          prepareId,
          blocker: result.blocker,
          approvedPayload: null,
          review,
          expiresAt: null,
          updatedAt,
        },
      };
    }

    return {
      ...session,
      prepare: {
        status: "failed",
        draftRevision,
        prepareId,
        error: result.error,
        updatedAt,
      },
    };
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

}
