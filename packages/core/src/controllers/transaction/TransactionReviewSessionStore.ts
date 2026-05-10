import type { TransactionPrepared } from "../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import type { TransactionReviewBlocker, TransactionReviewError } from "./review/types.js";
import type { TransactionProposalReviewState } from "./types.js";

type TransactionReviewSession = {
  draftRevision: number;
  sessionToken: string;
  updatedAt: number;
};

type TransactionReviewPreparingState = TransactionReviewSession & {
  status: "preparing";
};

type TransactionReviewReadyState = TransactionReviewSession & {
  status: "ready";
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionReviewBlockedState = TransactionReviewSession & {
  status: "blocked";
  blocker: TransactionReviewBlocker;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionReviewFailedState = TransactionReviewSession & {
  status: "failed";
  error: TransactionReviewError;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionReviewInvalidatedState = TransactionReviewSession & {
  status: "invalidated";
  error: TransactionReviewError;
  invalidatedBy: string;
};

type TransactionReviewState =
  | TransactionReviewPreparingState
  | TransactionReviewReadyState
  | TransactionReviewBlockedState
  | TransactionReviewFailedState
  | TransactionReviewInvalidatedState;

type CreateReviewSessionInput = {
  id: string;
  draftRevision: number;
  updatedAt: number;
};

type SettleReviewInput = {
  id: string;
  expectedDraftRevision: number;
  sessionToken: string;
  updatedAt: number;
};

const createReviewSession = (input: { draftRevision: number; updatedAt: number }): TransactionReviewSession => ({
  draftRevision: input.draftRevision,
  sessionToken: crypto.randomUUID(),
  updatedAt: input.updatedAt,
});

const buildPreparingState = (draftRevision: number, updatedAt: number): TransactionReviewPreparingState => ({
  ...createReviewSession({ draftRevision, updatedAt }),
  status: "preparing",
});

const toPublicReviewState = (session: TransactionReviewState | null): TransactionProposalReviewState | null => {
  if (!session) {
    return null;
  }

  switch (session.status) {
    case "preparing":
      return {
        sessionToken: session.sessionToken,
        status: "preparing",
        updatedAt: session.updatedAt,
        reviewPreparedSnapshot: null,
        blocker: null,
        error: null,
      };
    case "ready":
      return {
        sessionToken: session.sessionToken,
        status: "ready",
        updatedAt: session.updatedAt,
        reviewPreparedSnapshot: structuredClone(session.reviewPreparedSnapshot),
        blocker: null,
        error: null,
      };
    case "blocked":
      return {
        sessionToken: session.sessionToken,
        status: "blocked",
        updatedAt: session.updatedAt,
        reviewPreparedSnapshot: structuredClone(session.reviewPreparedSnapshot),
        blocker: structuredClone(session.blocker),
        error: null,
      };
    case "failed":
      return {
        sessionToken: session.sessionToken,
        status: "failed",
        updatedAt: session.updatedAt,
        reviewPreparedSnapshot: structuredClone(session.reviewPreparedSnapshot),
        blocker: null,
        error: structuredClone(session.error),
      };
    case "invalidated":
      return {
        sessionToken: session.sessionToken,
        status: "invalidated",
        updatedAt: session.updatedAt,
        reviewPreparedSnapshot: null,
        blocker: null,
        error: structuredClone(session.error),
        invalidatedBy: session.invalidatedBy,
      };
  }
};

export class TransactionReviewSessionStore {
  #states = new Map<string, TransactionReviewState>();
  #changeListeners = new Set<(transactionIds: string[]) => void>();

  getReviewState(id: string): TransactionProposalReviewState | null {
    return toPublicReviewState(this.#states.get(id) ?? null);
  }

  matchesDraftRevision(id: string, draftRevision: number): boolean {
    return this.#states.get(id)?.draftRevision === draftRevision;
  }

  getOrStartPrepare(input: CreateReviewSessionInput): TransactionProposalReviewState {
    const before = this.getReviewState(input.id);
    const active = this.#states.get(input.id);
    const nextState =
      active && active.draftRevision === input.draftRevision && active.status !== "invalidated"
        ? active
        : buildPreparingState(input.draftRevision, input.updatedAt);
    this.#states.set(input.id, nextState);
    const next = toPublicReviewState(nextState) as TransactionProposalReviewState;
    if (this.#didReviewStateChange(before, next)) {
      this.#notifyChanged([input.id]);
    }
    return next;
  }

  restartPrepare(input: CreateReviewSessionInput): TransactionProposalReviewState {
    const nextState = buildPreparingState(input.draftRevision, input.updatedAt);
    this.#states.set(input.id, nextState);
    const next = toPublicReviewState(nextState) as TransactionProposalReviewState;
    this.#notifyChanged([input.id]);
    return next;
  }

  settlePrepareReady(
    input: SettleReviewInput & {
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const review = this.#requireActiveReview(input);
    if (!review) {
      return null;
    }

    const settled: TransactionReviewReadyState = {
      draftRevision: review.draftRevision,
      sessionToken: review.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };
    this.#states.set(input.id, settled);
    const next = toPublicReviewState(settled);
    this.#notifyChanged([input.id]);
    return next;
  }

  settlePrepareBlocked(
    input: SettleReviewInput & {
      blocker: TransactionReviewBlocker;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const review = this.#requireActiveReview(input);
    if (!review) {
      return null;
    }

    const settled: TransactionReviewBlockedState = {
      draftRevision: review.draftRevision,
      sessionToken: review.sessionToken,
      updatedAt: input.updatedAt,
      status: "blocked",
      blocker: structuredClone(input.blocker),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };
    this.#states.set(input.id, settled);
    const next = toPublicReviewState(settled);
    this.#notifyChanged([input.id]);
    return next;
  }

  settlePrepareFailed(
    input: SettleReviewInput & {
      error: TransactionReviewError;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const review = this.#requireActiveReview(input);
    if (!review) {
      return null;
    }

    const settled: TransactionReviewFailedState = {
      draftRevision: review.draftRevision,
      sessionToken: review.sessionToken,
      updatedAt: input.updatedAt,
      status: "failed",
      error: structuredClone(input.error),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };
    this.#states.set(input.id, settled);
    const next = toPublicReviewState(settled);
    this.#notifyChanged([input.id]);
    return next;
  }

  invalidatePrepareFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction" || event.terminalReason === "user_approve") {
      return null;
    }

    const review = this.#states.get(event.subject.transactionId);
    if (!review) {
      return null;
    }

    const nextState: TransactionReviewInvalidatedState = {
      draftRevision: review.draftRevision,
      sessionToken: review.sessionToken,
      updatedAt,
      status: "invalidated",
      error: {
        reason: `approval.${event.terminalReason}`,
        message: event.error?.message ?? "Approval is no longer active.",
        ...(event.error ? { data: event.error } : {}),
      },
      invalidatedBy: event.terminalReason,
    };
    this.#states.set(event.subject.transactionId, nextState);
    const next = toPublicReviewState(nextState);
    this.#notifyChanged([event.subject.transactionId]);
    return next;
  }

  delete(id: string): void {
    this.#states.delete(id);
  }

  onChanged(handler: (transactionIds: string[]) => void): () => void {
    this.#changeListeners.add(handler);
    return () => {
      this.#changeListeners.delete(handler);
    };
  }

  #requireActiveReview(input: SettleReviewInput): TransactionReviewState | null {
    const review = this.#states.get(input.id);
    if (
      !review ||
      review.draftRevision !== input.expectedDraftRevision ||
      review.sessionToken !== input.sessionToken ||
      review.status === "invalidated"
    ) {
      return null;
    }

    return review;
  }

  #notifyChanged(transactionIds: string[]) {
    for (const handler of this.#changeListeners) {
      handler(transactionIds);
    }
  }

  #didReviewStateChange(
    previous: TransactionProposalReviewState | null,
    next: TransactionProposalReviewState | null,
  ): boolean {
    if (!previous || !next) {
      return previous !== next;
    }

    return (
      previous.sessionToken !== next.sessionToken ||
      previous.status !== next.status ||
      previous.updatedAt !== next.updatedAt
    );
  }
}
