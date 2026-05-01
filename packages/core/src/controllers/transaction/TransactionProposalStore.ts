import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ApprovalFinishedEvent } from "../approval/types.js";
import { buildSendTransactionApprovalReview } from "./review/projector.js";
import type {
  TransactionProposalReviewState,
  TransactionReviewBlocker,
  TransactionReviewError,
  TransactionReviewRuntimeStatus,
} from "./review/types.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionError,
  TransactionPrepared,
  TransactionProposalMeta,
  TransactionProposalPhase,
  TransactionProposalPhaseChange,
  TransactionProposalView,
  TransactionRequest,
  TransactionStateChange,
} from "./types.js";

export type TransactionProposalState = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  baseRequest: TransactionRequest;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  preparedAtDraftRevision: number | null;
  phase: TransactionProposalPhase;
  error: TransactionError | null;
  userRejected: boolean;
  reviewSessionToken: string | null;
  reviewStatus: TransactionReviewRuntimeStatus | null;
  reviewPreparedSnapshot: TransactionPrepared | null;
  reviewBlocker: TransactionReviewBlocker | null;
  reviewError: TransactionReviewError | null;
  reviewInvalidatedBy?: string | undefined;
  draftRevision: number;
  createdAt: number;
  updatedAt: number;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  | "approvalId"
  | "baseRequest"
  | "prepared"
  | "preparedAtDraftRevision"
  | "phase"
  | "error"
  | "userRejected"
  | "reviewSessionToken"
  | "reviewStatus"
  | "reviewPreparedSnapshot"
  | "reviewBlocker"
  | "reviewError"
  | "draftRevision"
> & {
  approvalId?: string | undefined;
  baseRequest?: TransactionRequest | undefined;
  prepared?: TransactionPrepared | null | undefined;
  preparedAtDraftRevision?: number | null | undefined;
  error?: TransactionError | null | undefined;
  userRejected?: boolean | undefined;
  reviewSessionToken?: string | null | undefined;
  reviewStatus?: TransactionReviewRuntimeStatus | null | undefined;
  reviewPreparedSnapshot?: TransactionPrepared | null | undefined;
  reviewBlocker?: TransactionReviewBlocker | null | undefined;
  reviewError?: TransactionReviewError | null | undefined;
  reviewInvalidatedBy?: string | undefined;
  draftRevision?: number | undefined;
};

type Options = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
};

type TransactionProposalPatch = Partial<
  Omit<
    TransactionProposalState,
    | "id"
    | "approvalId"
    | "namespace"
    | "chainRef"
    | "origin"
    | "fromAccountKey"
    | "baseRequest"
    | "phase"
    | "preparedAtDraftRevision"
    | "draftRevision"
    | "createdAt"
  >
>;

type TransactionProposalTransitionPatch = Partial<
  Pick<TransactionProposalState, "prepared" | "error" | "userRejected">
>;

const buildTransactionProposalState = (input: TransactionProposalInit): TransactionProposalState => ({
  ...input,
  approvalId: input.approvalId ?? input.id,
  baseRequest: structuredClone(input.baseRequest ?? input.request),
  request: structuredClone(input.request),
  prepared: structuredClone(input.prepared ?? null),
  preparedAtDraftRevision: input.prepared
    ? (input.preparedAtDraftRevision ?? input.draftRevision ?? 0)
    : (input.preparedAtDraftRevision ?? null),
  error: structuredClone(input.error ?? null),
  userRejected: input.userRejected ?? false,
  reviewSessionToken: input.reviewSessionToken ?? null,
  reviewStatus: input.reviewStatus ?? null,
  reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot ?? null),
  reviewBlocker: structuredClone(input.reviewBlocker ?? null),
  reviewError: structuredClone(input.reviewError ?? null),
  ...(input.reviewInvalidatedBy !== undefined ? { reviewInvalidatedBy: input.reviewInvalidatedBy } : {}),
  draftRevision: input.draftRevision ?? 0,
  phase: "pending",
});

const applyTransactionProposalPatch = (
  current: TransactionProposalState,
  patch: TransactionProposalPatch,
): TransactionProposalState => {
  const next: TransactionProposalState = {
    ...current,
    ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
    ...(patch.userRejected !== undefined ? { userRejected: patch.userRejected } : {}),
  };

  if (patch.request) {
    next.request = structuredClone(patch.request);
  }
  if (patch.prepared !== undefined) {
    next.prepared = structuredClone(patch.prepared);
    next.preparedAtDraftRevision = null;
  }
  if (patch.error !== undefined) {
    next.error = structuredClone(patch.error);
  }
  if (patch.reviewSessionToken !== undefined) {
    next.reviewSessionToken = patch.reviewSessionToken;
  }
  if (patch.reviewStatus !== undefined) {
    next.reviewStatus = patch.reviewStatus;
  }
  if (patch.reviewPreparedSnapshot !== undefined) {
    next.reviewPreparedSnapshot = structuredClone(patch.reviewPreparedSnapshot);
  }
  if (patch.reviewBlocker !== undefined) {
    next.reviewBlocker = structuredClone(patch.reviewBlocker);
  }
  if (patch.reviewError !== undefined) {
    next.reviewError = structuredClone(patch.reviewError);
  }
  if ("reviewInvalidatedBy" in patch) {
    next.reviewInvalidatedBy = patch.reviewInvalidatedBy;
  }

  return next;
};

const toReviewError = (event: ApprovalFinishedEvent<unknown>): TransactionReviewError => ({
  reason: `approval.${event.terminalReason}`,
  message: event.error?.message ?? "Approval is no longer active.",
  ...(event.error ? { data: event.error } : {}),
});

const buildProposalReviewState = (state: TransactionProposalState): TransactionProposalReviewState | null => {
  if (!state.reviewSessionToken || !state.reviewStatus) {
    return null;
  }

  return structuredClone({
    sessionToken: state.reviewSessionToken,
    status: state.reviewStatus,
    updatedAt: state.updatedAt,
    reviewPreparedSnapshot: state.reviewPreparedSnapshot,
    error: state.reviewError,
    blocker: state.reviewBlocker,
    ...(state.reviewInvalidatedBy !== undefined ? { invalidatedBy: state.reviewInvalidatedBy } : {}),
  });
};

export class TransactionProposalStore {
  #messenger: TransactionMessenger;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #records = new Map<string, TransactionProposalState>();
  #stateRevision = 0;
  #statePublishScheduled = false;
  #pendingStateChangeIds = new Set<string>();

  constructor({ messenger, accountCodecs }: Options) {
    this.#messenger = messenger;
    this.#accountCodecs = accountCodecs;
  }

  createPendingProposal(input: TransactionProposalInit): TransactionProposalMeta {
    const next = buildTransactionProposalState(input);
    this.#records.set(next.id, next);
    this.#scheduleStateChanged(next.id);
    return this.#toMeta(next);
  }

  get(id: string): TransactionProposalMeta | undefined {
    const state = this.#records.get(id);
    return state ? this.#toMeta(state) : undefined;
  }

  getView(id: string): TransactionProposalView | undefined {
    const state = this.#records.get(id);
    return state ? this.#buildProposalView(state) : undefined;
  }

  peek(id: string): TransactionProposalState | undefined {
    return this.#records.get(id);
  }

  patch(id: string, patch: TransactionProposalPatch): TransactionProposalMeta | null {
    const current = this.#records.get(id);
    if (!current) return null;

    const next = applyTransactionProposalPatch(current, patch);

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#scheduleStateChanged(id);
    return this.#toMeta(next);
  }

  beginPrepareSession(input: { id: string; updatedAt: number }): TransactionProposalReviewState | null {
    const current = this.#records.get(input.id);
    if (!current || !canPrepareProposal(current)) {
      return null;
    }

    const next = applyTransactionProposalPatch(current, {
      updatedAt: input.updatedAt,
      reviewSessionToken: crypto.randomUUID(),
      reviewStatus: "preparing",
      reviewPreparedSnapshot: null,
      reviewBlocker: null,
      reviewError: null,
      reviewInvalidatedBy: undefined,
    });

    this.#records.set(input.id, next);
    this.#scheduleStateChanged(input.id);
    return buildProposalReviewState(next);
  }

  replacePendingDraftRequest(input: {
    id: string;
    request: TransactionRequest;
    updatedAt: number;
  }): TransactionProposalMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.phase !== "pending") return null;

    const next = applyTransactionProposalPatch(current, {
      request: input.request,
      prepared: null,
      error: null,
      updatedAt: input.updatedAt,
    });
    next.draftRevision = current.draftRevision + 1;
    next.preparedAtDraftRevision = null;

    this.#records.set(input.id, next);
    this.#scheduleStateChanged(input.id);
    return this.#toMeta(next);
  }

  commitPrepared(
    id: string,
    expectedDraftRevision: number,
    prepared: TransactionPrepared | null,
  ): TransactionProposalMeta | null {
    const current = this.#records.get(id);
    if (!current || current.draftRevision !== expectedDraftRevision || !canPrepareProposal(current)) {
      return null;
    }

    const next = applyTransactionProposalPatch(current, { prepared });
    next.preparedAtDraftRevision = prepared ? expectedDraftRevision : null;

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#scheduleStateChanged(id);
    return this.#toMeta(next);
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
    if (!current?.reviewSessionToken || !current.reviewStatus) {
      return null;
    }

    const next = applyTransactionProposalPatch(current, {
      updatedAt,
      reviewStatus: "invalidated",
      reviewPreparedSnapshot: null,
      reviewBlocker: null,
      reviewError: toReviewError(event),
      reviewInvalidatedBy: event.terminalReason,
    });

    this.#records.set(event.subject.transactionId, next);
    this.#scheduleStateChanged(event.subject.transactionId);
    return buildProposalReviewState(next);
  }

  hasCurrentPrepared(id: string): boolean {
    const current = this.#records.get(id);
    return Boolean(current?.prepared && current.preparedAtDraftRevision === current.draftRevision);
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

  markUnpersistedProposal(input: {
    id: string;
    updatedAt: number;
    error: TransactionError;
  }): TransactionProposalMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: "approved",
      next: "unpersisted",
      updatedAt: input.updatedAt,
      patch: {
        error: input.error,
        userRejected: false,
      },
    });
  }

  delete(id: string): boolean {
    const deleted = this.#records.delete(id);
    if (deleted) {
      this.#scheduleStateChanged(id);
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
    this.#scheduleStateChanged(id);
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
      prepared: state.prepared,
      status: state.phase,
      error: state.error,
      userRejected: state.userRejected,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
  }

  #buildProposalView(state: TransactionProposalState): TransactionProposalView | undefined {
    if (!state.baseRequest || !state.request) {
      return undefined;
    }

    let from: string | null = null;
    try {
      from = this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: state.fromAccountKey });
    } catch {
      from = null;
    }

    const reviewState = buildProposalReviewState(state);
    const review = buildSendTransactionApprovalReview({
      updatedAt: state.updatedAt,
      review: reviewState,
      hasPrepared: Boolean(state.prepared),
      namespaceReview: null,
    });

    return structuredClone({
      kind: "proposal",
      id: state.id,
      approvalId: state.approvalId,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      fromAccountKey: state.fromAccountKey,
      from,
      baseRequest: state.baseRequest,
      currentRequest: state.request,
      draftRevision: state.draftRevision,
      prepared: state.prepared,
      reviewState: {
        sessionToken: reviewState?.sessionToken ?? null,
        status: reviewState?.status ?? null,
        reviewPreparedSnapshot: reviewState?.reviewPreparedSnapshot ?? null,
        blocker: reviewState?.blocker ?? null,
        error: reviewState?.error ?? null,
        ...(reviewState?.invalidatedBy !== undefined ? { invalidatedBy: reviewState.invalidatedBy } : {}),
        updatedAt: reviewState?.updatedAt ?? state.updatedAt,
      },
      review,
      phase: state.phase,
      failure:
        state.phase === "failed" || state.phase === "unpersisted" || state.userRejected || state.error
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
      current.reviewSessionToken !== input.sessionToken ||
      current.reviewStatus === "invalidated"
    ) {
      return null;
    }

    const next = applyTransactionProposalPatch(current, {
      updatedAt: input.updatedAt,
      reviewStatus: input.status,
      reviewPreparedSnapshot: input.reviewPreparedSnapshot,
      reviewBlocker: input.blocker,
      reviewError: input.error,
      reviewInvalidatedBy: input.invalidatedBy,
    });

    this.#records.set(id, next);
    this.#scheduleStateChanged(id);
    return buildProposalReviewState(next);
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

    const next = applyTransactionProposalPatch(current, {
      updatedAt: input.updatedAt,
      ...(input.patch ?? {}),
    });
    next.phase = input.next;

    this.#records.set(input.id, next);
    this.#emitStatusChange(current, next);
    this.#scheduleStateChanged(input.id);
    return this.#toMeta(next);
  }

  #scheduleStateChanged(id: string) {
    this.#pendingStateChangeIds.add(id);
    if (this.#statePublishScheduled) return;
    this.#statePublishScheduled = true;

    queueMicrotask(() => {
      this.#statePublishScheduled = false;
      this.#stateRevision += 1;
      const transactionIds = [...this.#pendingStateChangeIds];
      this.#pendingStateChangeIds.clear();
      const payload: TransactionStateChange = { revision: this.#stateRevision, transactionIds };
      this.#messenger.publish(TRANSACTION_STATE_CHANGED, payload);
    });
  }
}
