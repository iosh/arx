import type { ApprovalFinishedEvent } from "../../approval/types.js";
import type { TransactionReviewError, TransactionReviewSession } from "./types.js";

const toReviewError = (event: ApprovalFinishedEvent<unknown>): TransactionReviewError => ({
  reason: `approval.${event.terminalReason}`,
  message: event.error?.message ?? "Approval is no longer active.",
  ...(event.error ? { data: event.error } : {}),
});

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
    const current = this.#sessions.get(transactionId);
    const next: TransactionReviewSession = {
      transactionId,
      revision: (current?.revision ?? 0) + 1,
      status: "preparing",
      updatedAt,
      error: null,
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markReady(transactionId: string, revision: number, updatedAt: number): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.revision !== revision || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "ready",
      updatedAt,
      error: null,
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markFailed(
    transactionId: string,
    revision: number,
    updatedAt: number,
    error: TransactionReviewError | null,
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.revision !== revision || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "failed",
      updatedAt,
      error,
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
      error: toReviewError(event),
      invalidatedBy: event.terminalReason,
    };
    this.#sessions.set(event.subject.transactionId, next);
    return structuredClone(next);
  }
}
