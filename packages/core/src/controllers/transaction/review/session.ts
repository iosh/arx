import type { ApprovalFinishedEvent } from "../../approval/types.js";
import type { TransactionReviewError, TransactionReviewMessage, TransactionReviewSession } from "./types.js";

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
    const next: TransactionReviewSession = {
      transactionId,
      sessionToken: crypto.randomUUID(),
      status: "preparing",
      updatedAt,
      error: null,
      prepareFailure: null,
      approvalBlocker: null,
      reviewNotices: [],
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markReady(transactionId: string, sessionToken: string, updatedAt: number): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "ready",
      updatedAt,
      error: null,
      prepareFailure: current.prepareFailure,
      approvalBlocker: current.approvalBlocker,
      reviewNotices: structuredClone(current.reviewNotices),
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }

  markFailed(
    transactionId: string,
    sessionToken: string,
    updatedAt: number,
    error: TransactionReviewError | null,
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      status: "failed",
      updatedAt,
      error,
      prepareFailure: current.prepareFailure,
      approvalBlocker: current.approvalBlocker,
      reviewNotices: structuredClone(current.reviewNotices),
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
      prepareFailure: current.prepareFailure,
      approvalBlocker: current.approvalBlocker,
      reviewNotices: structuredClone(current.reviewNotices),
      invalidatedBy: event.terminalReason,
    };
    this.#sessions.set(event.subject.transactionId, next);
    return structuredClone(next);
  }

  setPreparedDiagnostics(
    transactionId: string,
    sessionToken: string,
    updatedAt: number,
    diagnostics: {
      prepareFailure: TransactionReviewMessage | null;
      approvalBlocker: TransactionReviewMessage | null;
      reviewNotices: TransactionReviewMessage[];
    },
  ): TransactionReviewSession | null {
    const current = this.#sessions.get(transactionId);
    if (!current || current.sessionToken !== sessionToken || current.status === "invalidated") {
      return null;
    }

    const next: TransactionReviewSession = {
      ...current,
      updatedAt,
      prepareFailure: diagnostics.prepareFailure,
      approvalBlocker: diagnostics.approvalBlocker,
      reviewNotices: structuredClone(diagnostics.reviewNotices),
    };
    this.#sessions.set(transactionId, next);
    return structuredClone(next);
  }
}
