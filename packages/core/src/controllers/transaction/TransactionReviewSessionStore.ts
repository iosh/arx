import type { TransactionPrepared } from "../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import type {
  TransactionProposalReviewState,
  TransactionReviewBlocker,
  TransactionReviewError,
  TransactionReviewRuntimeStatus,
} from "./review/types.js";

type TransactionReviewSessionState = {
  id: string;
  draftRevision: number;
  sessionToken: string;
  status: TransactionReviewRuntimeStatus;
  updatedAt: number;
  reviewPreparedSnapshot: TransactionPrepared | null;
  blocker: TransactionReviewBlocker | null;
  error: TransactionReviewError | null;
  invalidatedBy?: string | undefined;
};

const toReviewError = (event: ApprovalFinishedEvent<unknown>): TransactionReviewError => ({
  reason: `approval.${event.terminalReason}`,
  message: event.error?.message ?? "Approval is no longer active.",
  ...(event.error ? { data: event.error } : {}),
});

const toReviewState = (state: TransactionReviewSessionState): TransactionProposalReviewState =>
  structuredClone({
    sessionToken: state.sessionToken,
    status: state.status,
    updatedAt: state.updatedAt,
    reviewPreparedSnapshot: state.reviewPreparedSnapshot,
    error: state.error,
    blocker: state.blocker,
    ...(state.invalidatedBy !== undefined ? { invalidatedBy: state.invalidatedBy } : {}),
  });

export class TransactionReviewSessionStore {
  #records = new Map<string, TransactionReviewSessionState>();
  #changeListeners = new Set<(transactionIds: string[]) => void>();

  get(id: string): TransactionProposalReviewState | null {
    const current = this.#records.get(id);
    return current ? toReviewState(current) : null;
  }

  reuseOrBeginPrepareSession(input: {
    id: string;
    draftRevision: number;
    updatedAt: number;
  }): TransactionProposalReviewState {
    const current = this.#records.get(input.id);
    if (current && current.draftRevision === input.draftRevision && current.status !== "invalidated") {
      return toReviewState(current);
    }

    return this.beginPrepareSession(input);
  }

  beginPrepareSession(input: { id: string; draftRevision: number; updatedAt: number }): TransactionProposalReviewState {
    const next: TransactionReviewSessionState = {
      id: input.id,
      draftRevision: input.draftRevision,
      sessionToken: crypto.randomUUID(),
      status: "preparing",
      updatedAt: input.updatedAt,
      reviewPreparedSnapshot: null,
      blocker: null,
      error: null,
    };

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toReviewState(next);
  }

  markReviewReady(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalReviewState | null {
    return this.#updateReviewState(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: null,
      error: null,
      invalidatedBy: undefined,
    });
  }

  markReviewBlocked(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    blocker: TransactionReviewBlocker;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalReviewState | null {
    return this.#updateReviewState(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "blocked",
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: input.blocker,
      error: null,
      invalidatedBy: undefined,
    });
  }

  markReviewFailed(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    error: TransactionReviewError;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalReviewState | null {
    return this.#updateReviewState(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "failed",
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: null,
      error: input.error,
      invalidatedBy: undefined,
    });
  }

  invalidateReviewFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction") {
      return null;
    }

    const current = this.#records.get(event.subject.transactionId);
    if (!current) {
      return null;
    }

    const next: TransactionReviewSessionState = {
      ...current,
      updatedAt,
      status: "invalidated",
      reviewPreparedSnapshot: null,
      blocker: null,
      error: toReviewError(event),
      invalidatedBy: event.terminalReason,
    };

    this.#records.set(event.subject.transactionId, next);
    this.#notifyChanged([event.subject.transactionId]);
    return toReviewState(next);
  }

  clear(id: string): boolean {
    const deleted = this.#records.delete(id);
    if (deleted) {
      this.#notifyChanged([id]);
    }
    return deleted;
  }

  onChanged(handler: (transactionIds: string[]) => void): () => void {
    this.#changeListeners.add(handler);
    return () => {
      this.#changeListeners.delete(handler);
    };
  }

  #updateReviewState(
    id: string,
    input: {
      expectedDraftRevision: number;
      sessionToken: string;
      updatedAt: number;
      status: TransactionReviewRuntimeStatus;
      reviewPreparedSnapshot: TransactionPrepared | null;
      blocker: TransactionReviewBlocker | null;
      error: TransactionReviewError | null;
      invalidatedBy?: string | undefined;
    },
  ): TransactionProposalReviewState | null {
    const current = this.#records.get(id);
    if (
      !current ||
      current.draftRevision !== input.expectedDraftRevision ||
      current.sessionToken !== input.sessionToken ||
      current.status === "invalidated"
    ) {
      return null;
    }

    const next: TransactionReviewSessionState = {
      ...current,
      updatedAt: input.updatedAt,
      status: input.status,
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
      blocker: structuredClone(input.blocker),
      error: structuredClone(input.error),
      ...(input.invalidatedBy !== undefined ? { invalidatedBy: input.invalidatedBy } : {}),
    };

    this.#records.set(id, next);
    this.#notifyChanged([id]);
    return toReviewState(next);
  }

  #notifyChanged(transactionIds: string[]) {
    for (const handler of this.#changeListeners) {
      handler(transactionIds);
    }
  }
}
