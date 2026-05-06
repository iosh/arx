import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionError, TransactionPrepared, TransactionRequest } from "../../transactions/types.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import type {
  TransactionProposalReviewState,
  TransactionReviewBlocker,
  TransactionReviewError,
} from "./review/types.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionProposalMeta,
  TransactionProposalPhase,
  TransactionProposalPhaseChange,
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
  executionPrepared: TransactionPrepared;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalBlockedState = TransactionProposalPrepareSession & {
  status: "blocked";
  blocker: TransactionReviewBlocker;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalFailedState = TransactionProposalPrepareSession & {
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
  | TransactionProposalFailedState
  | TransactionProposalInvalidatedState;

export type TransactionProposalState = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  request: TransactionRequest;
  prepare: TransactionProposalPrepareState | null;
  phase: TransactionProposalPhase;
  error: TransactionError | null;
  userRejected: boolean;
  draftRevision: number;
  createdAt: number;
  updatedAt: number;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  "approvalId" | "prepare" | "phase" | "error" | "userRejected" | "draftRevision"
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
    | "prepare"
    | "phase"
    | "draftRevision"
    | "createdAt"
  >
>;

type TransactionProposalTransitionPatch = Partial<Pick<TransactionProposalState, "error" | "userRejected">>;

const toReviewErrorFromApproval = (event: ApprovalFinishedEvent<unknown>): TransactionReviewError => ({
  reason: `approval.${event.terminalReason}`,
  message: event.error?.message ?? "Approval is no longer active.",
  ...(event.error ? { data: event.error } : {}),
});

const createPrepareSession = (input: {
  draftRevision: number;
  updatedAt: number;
}): TransactionProposalPrepareSession => ({
  draftRevision: input.draftRevision,
  sessionToken: crypto.randomUUID(),
  updatedAt: input.updatedAt,
});

const buildBootstrapReadyPrepareState = (input: {
  draftRevision: number;
  updatedAt: number;
  executionPrepared: TransactionPrepared;
  reviewPreparedSnapshot: TransactionPrepared | null;
}): TransactionProposalReadyState => ({
  ...createPrepareSession({
    draftRevision: input.draftRevision,
    updatedAt: input.updatedAt,
  }),
  status: "ready",
  executionPrepared: structuredClone(input.executionPrepared),
  reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
});

const toPublicReviewState = (
  prepare: TransactionProposalPrepareState | null,
): TransactionProposalReviewState | null => {
  if (!prepare) {
    return null;
  }

  switch (prepare.status) {
    case "preparing":
      return {
        sessionToken: prepare.sessionToken,
        status: "preparing",
        updatedAt: prepare.updatedAt,
        reviewPreparedSnapshot: null,
        blocker: null,
        error: null,
      };
    case "ready":
      return {
        sessionToken: prepare.sessionToken,
        status: "ready",
        updatedAt: prepare.updatedAt,
        reviewPreparedSnapshot: structuredClone(prepare.reviewPreparedSnapshot),
        blocker: null,
        error: null,
      };
    case "blocked":
      return {
        sessionToken: prepare.sessionToken,
        status: "blocked",
        updatedAt: prepare.updatedAt,
        reviewPreparedSnapshot: structuredClone(prepare.reviewPreparedSnapshot),
        blocker: structuredClone(prepare.blocker),
        error: null,
      };
    case "failed":
      return {
        sessionToken: prepare.sessionToken,
        status: "failed",
        updatedAt: prepare.updatedAt,
        reviewPreparedSnapshot: structuredClone(prepare.reviewPreparedSnapshot),
        blocker: null,
        error: structuredClone(prepare.error),
      };
    case "invalidated":
      return {
        sessionToken: prepare.sessionToken,
        status: "invalidated",
        updatedAt: prepare.updatedAt,
        reviewPreparedSnapshot: null,
        blocker: null,
        error: structuredClone(prepare.error),
        invalidatedBy: prepare.invalidatedBy,
      };
  }
};

const buildPreparingPrepareState = (draftRevision: number, updatedAt: number): TransactionProposalPreparingState => ({
  ...createPrepareSession({ draftRevision, updatedAt }),
  status: "preparing",
});

const readExecutionPrepared = (state: TransactionProposalState): TransactionPrepared | null => {
  const prepare = state.prepare;
  if (!prepare || prepare.status !== "ready" || prepare.draftRevision !== state.draftRevision) {
    return null;
  }

  return structuredClone(prepare.executionPrepared);
};

const buildTransactionProposalState = (input: TransactionProposalInit): TransactionProposalState => {
  const draftRevision = input.draftRevision ?? 0;

  return {
    id: input.id,
    approvalId: input.approvalId ?? input.id,
    namespace: input.namespace,
    chainRef: input.chainRef,
    origin: input.origin,
    fromAccountKey: input.fromAccountKey,
    request: structuredClone(input.request),
    prepare: input.prepared
      ? buildBootstrapReadyPrepareState({
          draftRevision,
          updatedAt: input.updatedAt,
          executionPrepared: input.prepared,
          reviewPreparedSnapshot: input.prepared,
        })
      : null,
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

  getReviewState(id: string): TransactionProposalReviewState | null {
    return toPublicReviewState(this.#records.get(id)?.prepare ?? null);
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

    const next = applyTransactionProposalUpdate(current, {
      request: input.request,
      error: null,
      updatedAt: input.updatedAt,
    });
    next.draftRevision = current.draftRevision + 1;
    next.prepare = null;

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return this.#toMeta(next);
  }

  getOrStartPrepare(input: { id: string; updatedAt: number }): TransactionProposalReviewState | null {
    return this.#beginPrepare({
      id: input.id,
      updatedAt: input.updatedAt,
      forceRestart: false,
    });
  }

  restartPrepare(input: { id: string; updatedAt: number }): TransactionProposalReviewState | null {
    return this.#beginPrepare({
      id: input.id,
      updatedAt: input.updatedAt,
      forceRestart: true,
    });
  }

  settlePrepareReady(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    executionPrepared: TransactionPrepared;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    return this.#settlePrepareReview(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      executionPrepared: input.executionPrepared,
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: null,
      error: null,
    });
  }

  settlePrepareBlocked(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    blocker: TransactionReviewBlocker;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    return this.#settlePrepareReview(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "blocked",
      executionPrepared: null,
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: input.blocker,
      error: null,
    });
  }

  settlePrepareFailed(input: {
    id: string;
    expectedDraftRevision: number;
    sessionToken: string;
    updatedAt: number;
    error: TransactionReviewError;
    reviewPreparedSnapshot: TransactionPrepared | null;
  }): TransactionProposalMeta | null {
    return this.#settlePrepareReview(input.id, {
      expectedDraftRevision: input.expectedDraftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
      status: "failed",
      executionPrepared: null,
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: null,
      error: input.error,
    });
  }

  getPreparedForExecution(id: string): TransactionPrepared | null {
    const current = this.#records.get(id);
    return current ? readExecutionPrepared(current) : null;
  }

  invalidatePrepareFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction" || event.terminalReason === "user_approve") {
      return null;
    }

    const current = this.#records.get(event.subject.transactionId);
    if (!current?.prepare) {
      return null;
    }

    const next = applyTransactionProposalUpdate(current, { updatedAt });
    next.prepare = {
      draftRevision: current.prepare.draftRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt,
      status: "invalidated",
      error: toReviewErrorFromApproval(event),
      invalidatedBy: event.terminalReason,
    };

    this.#records.set(event.subject.transactionId, next);
    this.#notifyChanged([event.subject.transactionId]);
    return toPublicReviewState(next.prepare);
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
    patch?: TransactionProposalTransitionPatch | undefined;
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

  #beginPrepare(input: {
    id: string;
    updatedAt: number;
    forceRestart: boolean;
  }): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const activePrepare = current.prepare;
    if (
      !input.forceRestart &&
      activePrepare &&
      activePrepare.draftRevision === current.draftRevision &&
      activePrepare.status !== "invalidated"
    ) {
      return toPublicReviewState(activePrepare);
    }

    const next = applyTransactionProposalUpdate(current, { updatedAt: input.updatedAt });
    next.prepare = buildPreparingPrepareState(current.draftRevision, input.updatedAt);

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return toPublicReviewState(next.prepare);
  }

  #settlePrepareReview(
    id: string,
    input: {
      expectedDraftRevision: number;
      sessionToken: string;
      updatedAt: number;
      status: "ready" | "blocked" | "failed";
      executionPrepared: TransactionPrepared | null;
      reviewPreparedSnapshot: TransactionPrepared | null;
      blocker: TransactionReviewBlocker | null;
      error: TransactionReviewError | null;
    },
  ): TransactionProposalMeta | null {
    const current = this.#records.get(id);
    if (!current || !canPrepareProposal(current) || !current.prepare) {
      return null;
    }

    if (
      current.prepare.draftRevision !== input.expectedDraftRevision ||
      current.prepare.sessionToken !== input.sessionToken ||
      current.prepare.status === "invalidated"
    ) {
      return null;
    }

    const next = applyTransactionProposalUpdate(current, { updatedAt: input.updatedAt });
    next.prepare = this.#buildSettledPrepareState({
      draftRevision: current.prepare.draftRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt: input.updatedAt,
      status: input.status,
      executionPrepared: input.executionPrepared,
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      blocker: input.blocker,
      error: input.error,
    });

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#notifyChanged([id]);
    return this.#toMeta(next);
  }

  #moveProposal(input: {
    id: string;
    expected: TransactionProposalPhase | readonly TransactionProposalPhase[];
    next: TransactionProposalPhase;
    updatedAt: number;
    patch?: TransactionProposalTransitionPatch | undefined;
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

  #buildSettledPrepareState(input: {
    draftRevision: number;
    sessionToken: string;
    updatedAt: number;
    status: "ready" | "blocked" | "failed";
    executionPrepared: TransactionPrepared | null;
    reviewPreparedSnapshot: TransactionPrepared | null;
    blocker: TransactionReviewBlocker | null;
    error: TransactionReviewError | null;
  }): TransactionProposalReadyState | TransactionProposalBlockedState | TransactionProposalFailedState {
    const base = {
      draftRevision: input.draftRevision,
      sessionToken: input.sessionToken,
      updatedAt: input.updatedAt,
    };

    if (input.status === "ready") {
      if (!input.executionPrepared) {
        throw new Error("Ready prepare state requires execution prepared parameters.");
      }

      return {
        ...base,
        status: "ready",
        executionPrepared: structuredClone(input.executionPrepared),
        reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
      };
    }

    if (input.status === "blocked") {
      if (!input.blocker) {
        throw new Error("Blocked prepare state requires a blocker.");
      }

      return {
        ...base,
        status: "blocked",
        blocker: structuredClone(input.blocker),
        reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
      };
    }

    if (!input.error) {
      throw new Error("Failed prepare state requires an error.");
    }

    return {
      ...base,
      status: "failed",
      error: structuredClone(input.error),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };
  }
}
