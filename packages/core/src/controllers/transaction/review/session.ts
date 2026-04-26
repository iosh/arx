import type { TransactionPrepared } from "../../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../../approval/types.js";
import type { TransactionReviewBlocker, TransactionReviewError, TransactionReviewSession } from "./types.js";

const toReviewError = (event: ApprovalFinishedEvent<unknown>): TransactionReviewError => ({
  reason: `approval.${event.terminalReason}`,
  message: event.error?.message ?? "Approval is no longer active.",
  ...(event.error ? { data: event.error } : {}),
});

const cloneReviewPreparedSnapshot = (
  reviewPreparedSnapshot?: TransactionPrepared | null,
): TransactionPrepared | null =>
  reviewPreparedSnapshot === undefined ? null : structuredClone(reviewPreparedSnapshot);

export class TransactionReviewSessions {
  #sessions = new Map<string, TransactionReviewSession>();

  get(transactionId: string): TransactionReviewSession | undefined {
    const session = this.#sessions.get(transactionId);
    return session ? structuredClone(session) : undefined;
  }

  delete(transactionId: string): boolean {
    return this.#sessions.delete(transactionId);
  }

  begin(transactionId: string, updatedAt: number): TransactionReviewSession {
    const next: TransactionReviewSession = {
      transactionId,
      sessionToken: crypto.randomUUID(),
      status: "preparing",
      updatedAt,
      reviewPreparedSnapshot: null,
      error: null,
      blocker: null,
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markReady(
    transactionId: string,
    sessionToken: string,
    updatedAt: number,
    reviewPreparedSnapshot?: TransactionPrepared | null,
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "ready",
      updatedAt,
      reviewPreparedSnapshot: cloneReviewPreparedSnapshot(reviewPreparedSnapshot),
      error: null,
      blocker: null,
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markBlocked(
    transactionId: string,
    sessionToken: string,
    updatedAt: number,
    blocker: TransactionReviewBlocker,
    reviewPreparedSnapshot?: TransactionPrepared | null,
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "blocked",
      updatedAt,
      reviewPreparedSnapshot: cloneReviewPreparedSnapshot(reviewPreparedSnapshot),
      error: null,
      blocker: structuredClone(blocker),
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markFailed(
    transactionId: string,
    sessionToken: string,
    updatedAt: number,
    error: TransactionReviewError,
    reviewPreparedSnapshot?: TransactionPrepared | null,
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "failed",
      updatedAt,
      reviewPreparedSnapshot: cloneReviewPreparedSnapshot(reviewPreparedSnapshot),
      error: structuredClone(error),
      blocker: null,
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  invalidateFromApproval(event: ApprovalFinishedEvent<unknown>, updatedAt: number): TransactionReviewSession | null {
    if (event.subject?.kind !== "transaction") {
      return null;
    }

    const current = this.#sessions.get(event.subject.transactionId);
    if (!current) {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "invalidated",
      updatedAt,
      reviewPreparedSnapshot: null,
      error: toReviewError(event),
      blocker: null,
      invalidatedBy: event.terminalReason,
    };
    this.#sessions.set(event.subject.transactionId, next);
    return structuredClone(next);
  }
}
