import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionError, TransactionPrepared, TransactionRequest } from "../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import type { TransactionReviewBlocker, TransactionReviewError } from "./review/types.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionApprovalResult,
  TransactionProposalMeta,
  TransactionProposalPhase,
  TransactionProposalPhaseChange,
  TransactionProposalReviewState,
  TransactionProposalSnapshot,
} from "./types.js";

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

type TransactionProposalState = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  phase: TransactionProposalPhase;
  error: TransactionError | null;
  userRejected: boolean;
  draftRevision: number;
  createdAt: number;
  updatedAt: number;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  "approvalId" | "prepared" | "phase" | "error" | "userRejected" | "draftRevision"
> & {
  approvalId?: string | undefined;
  prepared?: TransactionPrepared | null | undefined;
  error?: TransactionError | null | undefined;
  userRejected?: boolean | undefined;
  draftRevision?: number | undefined;
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

const createReviewSession = (input: { draftRevision: number; updatedAt: number }): TransactionReviewSession => ({
  draftRevision: input.draftRevision,
  sessionToken: crypto.randomUUID(),
  updatedAt: input.updatedAt,
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

const buildPreparingState = (draftRevision: number, updatedAt: number): TransactionReviewPreparingState => ({
  ...createReviewSession({ draftRevision, updatedAt }),
  status: "preparing",
});

const buildTransactionProposalState = (input: TransactionProposalInit): TransactionProposalState => ({
  id: input.id,
  approvalId: input.approvalId ?? input.id,
  namespace: input.namespace,
  chainRef: input.chainRef,
  origin: input.origin,
  fromAccountKey: input.fromAccountKey,
  request: structuredClone(input.request),
  prepared: structuredClone(input.prepared ?? null),
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  error: structuredClone(input.error ?? null),
  userRejected: input.userRejected ?? false,
  draftRevision: input.draftRevision ?? 0,
  phase: "pending",
});

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

  return next;
};

export class TransactionProposalStore {
  #messenger: TransactionMessenger;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #records = new Map<string, TransactionProposalState>();
  #reviewStates = new Map<string, TransactionReviewState>();
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

  getReviewState(id: string): TransactionProposalReviewState | null {
    return toPublicReviewState(this.#reviewStates.get(id) ?? null);
  }

  replacePendingDraftRequest(input: {
    id: string;
    request: TransactionRequest;
    updatedAt: number;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.phase !== "pending") return null;

    const next = applyTransactionProposalUpdate(current, {
      request: input.request,
      error: null,
      prepared: null,
      updatedAt: input.updatedAt,
    });
    next.draftRevision = current.draftRevision + 1;

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return this.#toMeta(next);
  }

  getOrStartPrepare(input: { id: string; updatedAt: number }): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const before = this.getReviewState(input.id);
    const active = this.#reviewStates.get(input.id);
    const nextState =
      active && active.draftRevision === current.draftRevision && active.status !== "invalidated"
        ? active
        : buildPreparingState(current.draftRevision, input.updatedAt);
    this.#reviewStates.set(input.id, nextState);
    const next = toPublicReviewState(nextState);
    if (next && this.#didReviewStateChange(before, next)) {
      this.#notifyChanged([input.id]);
    }
    return next;
  }

  restartPrepare(input: { id: string; updatedAt: number }): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const nextState = buildPreparingState(current.draftRevision, input.updatedAt);
    this.#reviewStates.set(input.id, nextState);
    const next = toPublicReviewState(nextState);
    if (next) {
      this.#notifyChanged([input.id]);
    }
    return next;
  }

  settlePrepareReady(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    executionPrepared: TransactionPrepared;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.draftRevision !== input.expectedDraftRevision || !canPrepareProposal(current)) {
      return null;
    }

    const review = this.#reviewStates.get(input.id);
    if (
      !review ||
      review.draftRevision !== input.expectedDraftRevision ||
      review.sessionToken !== input.sessionToken ||
      review.status === "invalidated"
    ) {
      return null;
    }

    const settled: TransactionReviewReadyState = {
      draftRevision: review.draftRevision,
      sessionToken: review.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };
    this.#reviewStates.set(input.id, settled);

    const updated = applyTransactionProposalUpdate(current, {
      prepared: input.executionPrepared,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, updated);
    this.#notifyChanged([input.id]);
    return this.#toMeta(updated);
  }

  settlePrepareBlocked(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    blocker: TransactionReviewBlocker;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.draftRevision !== input.expectedDraftRevision || !canPrepareProposal(current)) {
      return null;
    }

    const review = this.#reviewStates.get(input.id);
    if (
      !review ||
      review.draftRevision !== input.expectedDraftRevision ||
      review.sessionToken !== input.sessionToken ||
      review.status === "invalidated"
    ) {
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
    this.#reviewStates.set(input.id, settled);

    const updated = applyTransactionProposalUpdate(current, {
      prepared: null,
      updatedAt: input.updatedAt,
    });
    this.#records.set(input.id, updated);
    this.#notifyChanged([input.id]);
    return this.#toMeta(updated);
  }

  settlePrepareFailed(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    error: TransactionReviewError;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.draftRevision !== input.expectedDraftRevision || !canPrepareProposal(current)) {
      return null;
    }

    const review = this.#reviewStates.get(input.id);
    if (
      !review ||
      review.draftRevision !== input.expectedDraftRevision ||
      review.sessionToken !== input.sessionToken ||
      review.status === "invalidated"
    ) {
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
    this.#reviewStates.set(input.id, settled);

    const updated = applyTransactionProposalUpdate(current, {
      prepared: null,
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

  approveReadyProposal(input: { id: string; updatedAt: number }): TransactionApprovalResult {
    const existing = this.getView(input.id) ?? null;
    if (!existing) {
      return {
        status: "failed",
        reason: "not_found",
        message: "Transaction not found.",
        data: { transactionId: input.id },
      };
    }

    const current = this.#records.get(input.id);
    if (!current || current.phase !== "pending") {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: input.id, phase: current?.phase ?? existing.phase },
      };
    }

    const review = this.#reviewStates.get(input.id);
    if (!review) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: input.id, prepareState: "missing_review" },
      };
    }

    if (review.draftRevision !== current.draftRevision) {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: input.id, prepareState: "stale_review" },
      };
    }

    if (review.status === "preparing") {
      return {
        status: "failed",
        reason: "prepare_not_ready",
        transaction: existing,
        message: "Transaction preparation is not ready yet.",
        data: { transactionId: input.id, prepareState: review.status },
      };
    }

    if (review.status === "blocked") {
      return {
        status: "failed",
        reason: "prepare_blocked",
        transaction: existing,
        message: review.blocker?.message ?? "Transaction is blocked.",
        data: {
          transactionId: input.id,
          ...(review.blocker ? { blocker: review.blocker } : {}),
        },
      };
    }

    if (review.status === "failed" || review.status === "invalidated") {
      return {
        status: "failed",
        reason: "prepare_failed",
        transaction: existing,
        message: review.error?.message ?? "Transaction preparation failed.",
        data: {
          transactionId: input.id,
          ...(review.error ? { error: review.error } : {}),
        },
      };
    }

    if (!this.getPreparedForExecution(input.id)) {
      return {
        status: "failed",
        reason: "prepare_failed",
        transaction: existing,
        message: "Transaction prepared snapshot is missing.",
        data: {
          transactionId: input.id,
          prepareState: "ready_without_prepared",
        },
      };
    }

    const updated = this.#moveProposal({
      id: input.id,
      expected: "pending",
      next: "approved",
      updatedAt: input.updatedAt,
    });
    if (!updated) {
      return {
        status: "failed",
        reason: "not_pending",
        transaction: this.getView(input.id) ?? existing,
        message: "Transaction is no longer pending approval.",
        data: { transactionId: input.id },
      };
    }

    return { status: "approved", transactionId: input.id };
  }

  invalidatePrepareFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction" || event.terminalReason === "user_approve") {
      return null;
    }

    const review = this.#reviewStates.get(event.subject.transactionId);
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
    this.#reviewStates.set(event.subject.transactionId, nextState);

    const current = this.#records.get(event.subject.transactionId);
    if (!current) {
      this.#notifyChanged([event.subject.transactionId]);
      return toPublicReviewState(nextState);
    }

    const updated = applyTransactionProposalUpdate(current, {
      prepared: null,
      updatedAt,
    });
    this.#records.set(current.id, updated);
    this.#notifyChanged([current.id]);
    return toPublicReviewState(nextState);
  }

  failProposal(input: {
    id: string;
    updatedAt: number;
    patch?: Partial<Pick<TransactionProposalState, "error" | "userRejected" | "prepared">> | undefined;
  }): TransactionProposalMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: ["pending", "approved"],
      next: "failed",
      updatedAt: input.updatedAt,
      patch: input.patch,
    });
  }

  delete(id: string): boolean {
    this.#reviewStates.delete(id);
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

    this.#reviewStates.delete(id);
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
    patch?: Partial<Pick<TransactionProposalState, "error" | "userRejected" | "prepared">> | undefined;
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
