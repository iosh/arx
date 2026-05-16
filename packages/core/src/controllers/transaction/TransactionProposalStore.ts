import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionPrepared, TransactionRequest } from "../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import type { TransactionReviewBlocker, TransactionReviewError } from "./review/types.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionProposalMeta,
  TransactionProposalPhase,
  TransactionProposalPhaseChange,
  TransactionProposalReviewState,
  TransactionProposalSnapshot,
} from "./types.js";

type TransactionProposalPrepareSession = {
  draftRevision: number;
  sessionToken: string;
  updatedAt: number;
};

type TransactionProposalPreparingState = TransactionProposalPrepareSession & {
  status: "preparing";
};

type TransactionProposalReadyState = TransactionProposalPrepareSession & {
  status: "ready";
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalBlockedState = TransactionProposalPrepareSession & {
  status: "blocked";
  blocker: TransactionReviewBlocker;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalFailedPrepareState = TransactionProposalPrepareSession & {
  status: "failed";
  error: TransactionReviewError;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalInvalidatedState = TransactionProposalPrepareSession & {
  status: "invalidated";
  error: TransactionReviewError;
  invalidatedBy: string;
};

type TransactionProposalPrepareState =
  | TransactionProposalPreparingState
  | TransactionProposalReadyState
  | TransactionProposalBlockedState
  | TransactionProposalFailedPrepareState
  | TransactionProposalInvalidatedState;

type TransactionProposalState = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  review: TransactionProposalPrepareState | null;
  phase: TransactionProposalPhase;
  error: import("../../transactions/types.js").TransactionError | null;
  userRejected: boolean;
  draftRevision: number;
  createdAt: number;
  updatedAt: number;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  "approvalId" | "prepared" | "review" | "phase" | "error" | "userRejected" | "draftRevision"
> & {
  approvalId?: string | undefined;
  prepared?: TransactionPrepared | null | undefined;
  error?: import("../../transactions/types.js").TransactionError | null | undefined;
  userRejected?: boolean | undefined;
  draftRevision?: number | undefined;
};

type StartPrepareInput = {
  id: string;
  draftRevision: number;
  updatedAt: number;
};

type SettlePrepareInput = {
  id: string;
  expectedDraftRevision: number;
  sessionToken: string;
  updatedAt: number;
};

type Options = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
};

type TransactionProposalUpdate = Partial<
  Omit<
    TransactionProposalState,
    | "id"
    | "approvalId"
    | "namespace"
    | "chainRef"
    | "origin"
    | "fromAccountKey"
    | "phase"
    | "draftRevision"
    | "createdAt"
  >
>;

const readExecutionPrepared = (state: TransactionProposalState): TransactionPrepared | null => state.prepared;

const createPrepareSession = (input: {
  draftRevision: number;
  updatedAt: number;
}): TransactionProposalPrepareSession => ({
  draftRevision: input.draftRevision,
  sessionToken: crypto.randomUUID(),
  updatedAt: input.updatedAt,
});

const buildPreparingState = (draftRevision: number, updatedAt: number): TransactionProposalPreparingState => ({
  ...createPrepareSession({ draftRevision, updatedAt }),
  status: "preparing",
});

const buildInitialReviewState = (input: {
  draftRevision: number;
  updatedAt: number;
  prepared: TransactionPrepared | null;
}): TransactionProposalPrepareState => {
  if (input.prepared === null) {
    return buildPreparingState(input.draftRevision, input.updatedAt);
  }

  return {
    ...createPrepareSession({ draftRevision: input.draftRevision, updatedAt: input.updatedAt }),
    status: "ready",
    reviewPreparedSnapshot: structuredClone(input.prepared),
  };
};

const toPublicReviewState = (
  session: TransactionProposalPrepareState | null,
): TransactionProposalReviewState | null => {
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

const buildTransactionProposalState = (input: TransactionProposalInit): TransactionProposalState => {
  const draftRevision = input.draftRevision ?? 0;
  const prepared = structuredClone(input.prepared ?? null);

  return {
    id: input.id,
    approvalId: input.approvalId ?? input.id,
    namespace: input.namespace,
    chainRef: input.chainRef,
    origin: input.origin,
    fromAccountKey: input.fromAccountKey,
    request: structuredClone(input.request),
    prepared,
    review: buildInitialReviewState({
      draftRevision,
      updatedAt: input.updatedAt,
      prepared,
    }),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    error: structuredClone(input.error ?? null),
    userRejected: input.userRejected ?? false,
    draftRevision,
    phase: "pending",
  };
};

const applyTransactionProposalUpdate = (
  current: TransactionProposalState,
  update: TransactionProposalUpdate,
): TransactionProposalState => {
  const next: TransactionProposalState = {
    ...current,
    ...(update.updatedAt !== undefined ? { updatedAt: update.updatedAt } : {}),
    ...(update.userRejected !== undefined ? { userRejected: update.userRejected } : {}),
  };

  if (update.request) {
    next.request = structuredClone(update.request);
  }
  if (update.error !== undefined) {
    next.error = structuredClone(update.error);
  }
  if (update.prepared !== undefined) {
    next.prepared = structuredClone(update.prepared);
  }
  if (update.review !== undefined) {
    next.review = structuredClone(update.review);
  }

  return next;
};

export class TransactionProposalStore {
  #messenger: TransactionMessenger;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #records = new Map<string, TransactionProposalState>();
  #changeListeners = new Set<(transactionIds: string[]) => void>();

  constructor({ messenger, accountCodecs }: Options) {
    this.#messenger = messenger;
    this.#accountCodecs = accountCodecs;
  }

  createPendingProposal(input: TransactionProposalInit): TransactionProposalMeta {
    const next = buildTransactionProposalState(input);
    this.#records.set(next.id, next);
    this.#notifyChanged([next.id]);
    return this.#toMeta(next);
  }

  get(id: string): TransactionProposalMeta | undefined {
    const state = this.#records.get(id);
    return state ? this.#toMeta(state) : undefined;
  }

  getView(id: string): TransactionProposalSnapshot | undefined {
    const state = this.#records.get(id);
    return state ? this.#buildProposalView(state) : undefined;
  }

  peek(id: string): TransactionProposalState | undefined {
    return this.#records.get(id);
  }

  replacePendingDraftRequest(input: {
    id: string;
    request: TransactionRequest;
    updatedAt: number;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.phase !== "pending") return null;

    const nextDraftRevision = current.draftRevision + 1;
    const next = applyTransactionProposalUpdate(current, {
      request: input.request,
      error: null,
      prepared: null,
      review: buildPreparingState(nextDraftRevision, input.updatedAt),
      updatedAt: input.updatedAt,
    });
    next.draftRevision = nextDraftRevision;

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return this.#toMeta(next);
  }

  updatePreparedForDraft(input: {
    id: string;
    expectedDraftRevision: number;
    updatedAt: number;
    prepared: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.draftRevision !== input.expectedDraftRevision || !canPrepareProposal(current)) {
      return null;
    }

    const updated = applyTransactionProposalUpdate(current, {
      prepared: input.prepared,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, updated);
    this.#notifyChanged([input.id]);
    return this.#toMeta(updated);
  }

  getPreparedForExecution(id: string): TransactionPrepared | null {
    const current = this.#records.get(id);
    return current ? readExecutionPrepared(current) : null;
  }

  getReviewState(id: string): TransactionProposalReviewState | null {
    return toPublicReviewState(this.#records.get(id)?.review ?? null);
  }

  matchesDraftRevision(id: string, draftRevision: number): boolean {
    return this.#records.get(id)?.review?.draftRevision === draftRevision;
  }

  getOrStartPrepare(input: StartPrepareInput): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const previous = toPublicReviewState(current.review);
    const review =
      current.review && current.review.draftRevision === input.draftRevision && current.review.status !== "invalidated"
        ? current.review
        : buildPreparingState(input.draftRevision, input.updatedAt);

    const next =
      review === current.review
        ? current
        : applyTransactionProposalUpdate(current, {
            review,
            updatedAt: input.updatedAt,
          });

    this.#records.set(input.id, next);
    const publicReview = toPublicReviewState(next.review);
    if (this.#didReviewStateChange(previous, publicReview)) {
      this.#notifyChanged([input.id]);
    }

    return publicReview;
  }

  restartPrepare(input: StartPrepareInput): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const next = applyTransactionProposalUpdate(current, {
      prepared: null,
      review: buildPreparingState(input.draftRevision, input.updatedAt),
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toPublicReviewState(next.review);
  }

  settlePrepareReady(
    input: SettlePrepareInput & {
      executionPrepared: TransactionPrepared;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return null;
    }

    const review: TransactionProposalReadyState = {
      draftRevision: current.review.draftRevision,
      sessionToken: current.review.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      prepared: input.executionPrepared,
      review,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toPublicReviewState(review);
  }

  settlePrepareBlocked(
    input: SettlePrepareInput & {
      blocker: TransactionReviewBlocker;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return null;
    }

    const review: TransactionProposalBlockedState = {
      draftRevision: current.review.draftRevision,
      sessionToken: current.review.sessionToken,
      updatedAt: input.updatedAt,
      status: "blocked",
      blocker: structuredClone(input.blocker),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      prepared: null,
      review,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toPublicReviewState(review);
  }

  settlePrepareFailed(
    input: SettlePrepareInput & {
      error: TransactionReviewError;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): TransactionProposalReviewState | null {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return null;
    }

    const review: TransactionProposalFailedPrepareState = {
      draftRevision: current.review.draftRevision,
      sessionToken: current.review.sessionToken,
      updatedAt: input.updatedAt,
      status: "failed",
      error: structuredClone(input.error),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      prepared: null,
      review,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toPublicReviewState(review);
  }

  invalidatePrepareFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction" || event.terminalReason === "user_approve") {
      return null;
    }

    const current = this.#records.get(event.subject.transactionId);
    if (!current?.review) {
      return null;
    }

    const review: TransactionProposalInvalidatedState = {
      draftRevision: current.review.draftRevision,
      sessionToken: current.review.sessionToken,
      updatedAt,
      status: "invalidated",
      error: {
        reason: `approval.${event.terminalReason}`,
        message: event.error?.message ?? "Approval is no longer active.",
        ...(event.error ? { data: event.error } : {}),
      },
      invalidatedBy: event.terminalReason,
    };

    const next = applyTransactionProposalUpdate(current, {
      prepared: null,
      review,
      updatedAt,
    });
    this.#records.set(event.subject.transactionId, next);
    this.#notifyChanged([event.subject.transactionId]);
    return toPublicReviewState(review);
  }

  clearPrepareState(input: { id: string; updatedAt: number }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current) {
      return null;
    }

    const next = applyTransactionProposalUpdate(current, {
      prepared: null,
      review: null,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return this.#toMeta(next);
  }

  approvePendingProposal(input: { id: string; updatedAt: number }): TransactionProposalMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: "pending",
      next: "approved",
      updatedAt: input.updatedAt,
    });
  }

  failProposal(input: {
    id: string;
    updatedAt: number;
    error: import("../../transactions/types.js").TransactionError | null;
    userRejected: boolean;
  }): TransactionProposalMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: ["pending", "approved"],
      next: "failed",
      updatedAt: input.updatedAt,
      patch: {
        error: input.error,
        userRejected: input.userRejected,
        prepared: null,
        review: null,
      },
    });
  }

  delete(id: string): boolean {
    const deleted = this.#records.delete(id);
    if (deleted) {
      this.#notifyChanged([id]);
    }
    return deleted;
  }

  listExecutableProposalIds(): string[] {
    return Array.from(this.#records.values())
      .filter((record) => record.phase === "approved")
      .map((record) => record.id);
  }

  clearProposalAfterRecordPersisted(id: string): TransactionProposalMeta | null {
    const current = this.#records.get(id);
    if (!current || current.phase !== "approved") {
      return null;
    }

    this.#records.delete(id);
    this.#notifyChanged([id]);
    return this.#toMeta(current);
  }

  #toMeta(state: TransactionProposalState): TransactionProposalMeta {
    let from: string | null = null;
    try {
      from = this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: state.fromAccountKey });
    } catch {
      from = null;
    }

    return structuredClone({
      id: state.id,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      from,
      request: state.request,
      prepared: readExecutionPrepared(state),
      status: state.phase,
      error: state.error,
      userRejected: state.userRejected,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
  }

  #buildProposalView(state: TransactionProposalState): TransactionProposalSnapshot | undefined {
    if (!state.request) {
      return undefined;
    }

    let from: string | null = null;
    try {
      from = this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: state.fromAccountKey });
    } catch {
      from = null;
    }

    return structuredClone({
      kind: "proposal",
      id: state.id,
      approvalId: state.approvalId,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      from,
      currentRequest: state.request,
      prepared: readExecutionPrepared(state),
      phase: state.phase,
      failure:
        state.phase === "failed" || state.userRejected || state.error
          ? {
              error: structuredClone(state.error),
              userRejected: state.userRejected,
            }
          : null,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
  }

  #emitStatusChange(previous: TransactionProposalState, next: TransactionProposalState) {
    if (previous.phase === next.phase) {
      return;
    }

    const proposal = this.#buildProposalView(next);
    if (!proposal) return;

    const payload: TransactionProposalPhaseChange = {
      kind: "proposal_phase",
      id: next.id,
      previousPhase: previous.phase,
      nextPhase: next.phase,
      proposal,
    };
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
  }

  #moveProposal(input: {
    id: string;
    expected: TransactionProposalPhase | readonly TransactionProposalPhase[];
    next: TransactionProposalPhase;
    updatedAt: number;
    patch?: Partial<Pick<TransactionProposalState, "error" | "userRejected" | "prepared" | "review">> | undefined;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current) return null;

    const expected = Array.isArray(input.expected) ? input.expected : [input.expected];
    if (!expected.includes(current.phase)) {
      return null;
    }

    const next = applyTransactionProposalUpdate(current, {
      updatedAt: input.updatedAt,
      ...(input.patch ?? {}),
    });
    next.phase = input.next;

    this.#records.set(input.id, next);
    this.#emitStatusChange(current, next);
    this.#notifyChanged([input.id]);
    return this.#toMeta(next);
  }

  #requireActiveReview(input: SettlePrepareInput): {
    proposal: TransactionProposalState;
    review: TransactionProposalPrepareState;
  } | null {
    const proposal = this.#records.get(input.id);
    const review = proposal?.review;
    if (
      !proposal ||
      !review ||
      review.draftRevision !== input.expectedDraftRevision ||
      review.sessionToken !== input.sessionToken ||
      review.status === "invalidated"
    ) {
      return null;
    }

    return { proposal, review };
  }

  onChanged(handler: (transactionIds: string[]) => void): () => void {
    this.#changeListeners.add(handler);
    return () => {
      this.#changeListeners.delete(handler);
    };
  }

  notifyChanged(transactionIds: string[]): void {
    this.#notifyChanged(transactionIds);
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
