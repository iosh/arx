import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ApprovalFinishedEvent } from "../../controllers/approval/types.js";
import type { TransactionProposalStatus, TransactionProposalTermination } from "../proposal/index.js";
import type { TransactionReviewBlocker, TransactionReviewError } from "../review/types.js";
import type {
  ControllerTransactionProposalSnapshot,
  TransactionProposalMeta,
  TransactionProposalPrepareSnapshot,
  TransactionProposalReviewState,
  TransactionProposalStateSnapshot,
  TransactionProposalStatusChange,
  TransactionProposalTerminationReason,
} from "../runtime.js";
import { canPrepareProposal } from "../status.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "../topics.js";
import type { TransactionError, TransactionPrepared, TransactionRequest } from "../types.js";

type TransactionProposalPrepareSession = {
  requestRevision: number;
  sessionToken: string;
  updatedAt: number;
};

type TransactionProposalPreparingState = TransactionProposalPrepareSession & {
  status: "preparing";
  prepared: null;
};

type TransactionProposalReadyState = TransactionProposalPrepareSession & {
  status: "ready";
  prepared: TransactionPrepared;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalBlockedState = TransactionProposalPrepareSession & {
  status: "blocked";
  prepared: null;
  blocker: TransactionReviewBlocker;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalFailedPrepareState = TransactionProposalPrepareSession & {
  status: "failed";
  prepared: null;
  error: TransactionReviewError;
  reviewPreparedSnapshot: TransactionPrepared | null;
};

type TransactionProposalInvalidatedState = TransactionProposalPrepareSession & {
  status: "invalidated";
  prepared: null;
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
  requestedAddress: string | null;
  request: TransactionRequest;
  status: "active" | "approved" | "terminated";
  termination: TransactionProposalTermination | null;
  createdAt: number;
  updatedAt: number;
  prepare: TransactionProposalPrepareState;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  "approvalId" | "status" | "termination" | "prepare" | "requestedAddress"
> & {
  approvalId?: string | undefined;
  prepared?: TransactionPrepared | null | undefined;
  requestRevision?: number | undefined;
  requestedAddress?: string | null | undefined;
  createdAt: number;
  updatedAt: number;
};

type StartPrepareInput = {
  id: string;
  requestRevision: number;
  updatedAt: number;
};

type SettlePrepareInput = {
  id: string;
  expectedRequestRevision: number;
  sessionToken: string;
  updatedAt: number;
};

type ReplacePendingDraftRequestResult =
  | {
      status: "updated";
      proposal: TransactionProposalMeta;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_pending";
      statusValue: TransactionProposalStatus;
    };

type FailProposalResult =
  | {
      status: "failed";
      proposal: TransactionProposalMeta;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_active";
      statusValue: TransactionProposalStatus;
    };

type ApprovePendingProposalResult =
  | {
      status: "approved";
      proposal: TransactionProposalMeta;
      prepared: TransactionPrepared;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_pending";
      statusValue: TransactionProposalStatus;
    }
  | {
      status: "prepare_not_ready";
      prepareState: "preparing";
    }
  | {
      status: "prepare_blocked";
      blocker: TransactionReviewBlocker;
    }
  | {
      status: "prepare_failed";
      prepareState: "failed" | "invalidated";
      error: TransactionReviewError;
    };

type UpdatePreparedForDraftResult =
  | {
      status: "updated";
      proposal: TransactionProposalMeta;
    }
  | {
      status: "not_found";
    }
  | {
      status: "stale";
      requestRevision: number;
    }
  | {
      status: "not_preparable";
      statusValue: TransactionProposalStatus;
    };

type OpenPrepareResult =
  | {
      status: "opened";
      review: TransactionProposalReviewState;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_preparable";
      statusValue: TransactionProposalStatus;
    };

type RestartPrepareResult =
  | {
      status: "restarted";
      review: TransactionProposalReviewState;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_preparable";
      statusValue: TransactionProposalStatus;
    };

type SettlePrepareResult =
  | {
      status: "settled";
      review: TransactionProposalReviewState;
    }
  | {
      status: "not_found";
    }
  | {
      status: "stale";
      requestRevision: number;
      sessionToken: string;
    }
  | {
      status: "invalidated";
      invalidatedBy: string;
    };

type ClearProposalAfterRecordPersistedResult =
  | {
      status: "cleared";
      proposal: TransactionProposalMeta;
    }
  | {
      status: "not_found";
    }
  | {
      status: "not_approved";
      statusValue: TransactionProposalStatus;
    };

type Options = {
  messenger: TransactionMessenger;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
};

type TransactionProposalUpdate = Partial<
  Omit<TransactionProposalState, "id" | "approvalId" | "namespace" | "chainRef" | "origin" | "fromAccountKey">
>;

const readExecutionPrepared = (state: TransactionProposalState): TransactionPrepared | null => {
  return structuredClone(state.prepare.prepared);
};

const createPrepareSession = (input: {
  requestRevision: number;
  updatedAt: number;
}): TransactionProposalPrepareSession => ({
  requestRevision: input.requestRevision,
  sessionToken: crypto.randomUUID(),
  updatedAt: input.updatedAt,
});

const buildPreparingState = (requestRevision: number, updatedAt: number): TransactionProposalPreparingState => ({
  ...createPrepareSession({ requestRevision, updatedAt }),
  status: "preparing",
  prepared: null,
});

const buildReadyState = (input: {
  requestRevision: number;
  updatedAt: number;
  prepared: TransactionPrepared;
  reviewPreparedSnapshot: TransactionPrepared | null;
}): TransactionProposalReadyState => ({
  ...createPrepareSession({ requestRevision: input.requestRevision, updatedAt: input.updatedAt }),
  status: "ready",
  prepared: structuredClone(input.prepared),
  reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
});

const toPublicReviewState = (session: TransactionProposalPrepareState): TransactionProposalReviewState => {
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

const isUserRejectedTermination = (reason: TransactionProposalTerminationReason): boolean => {
  return reason === "user_rejected";
};

const buildTransactionProposalState = (input: TransactionProposalInit): TransactionProposalState => {
  const requestRevision = input.requestRevision ?? 0;
  const reviewPreparedSnapshot = structuredClone(input.prepared ?? null);

  return {
    id: input.id,
    approvalId: input.approvalId ?? input.id,
    namespace: input.namespace,
    chainRef: input.chainRef,
    origin: input.origin,
    fromAccountKey: input.fromAccountKey,
    requestedAddress: input.requestedAddress ?? null,
    request: structuredClone(input.request),
    status: "active",
    termination: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    prepare:
      reviewPreparedSnapshot === null
        ? buildPreparingState(requestRevision, input.updatedAt)
        : buildReadyState({
            requestRevision,
            updatedAt: input.updatedAt,
            prepared: reviewPreparedSnapshot,
            reviewPreparedSnapshot,
          }),
  };
};

const applyTransactionProposalUpdate = (
  current: TransactionProposalState,
  update: TransactionProposalUpdate,
): TransactionProposalState => {
  const next: TransactionProposalState = {
    ...current,
    ...(update.request ? { request: structuredClone(update.request) } : {}),
    ...(update.status ? { status: update.status } : {}),
    ...(update.termination !== undefined ? { termination: structuredClone(update.termination) } : {}),
    ...(update.createdAt !== undefined ? { createdAt: update.createdAt } : {}),
    ...(update.updatedAt !== undefined ? { updatedAt: update.updatedAt } : {}),
    ...(update.prepare ? { prepare: structuredClone(update.prepare) } : {}),
    ...(update.requestedAddress !== undefined ? { requestedAddress: update.requestedAddress } : {}),
  };

  return next;
};

export class TransactionProposalRuntime {
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

  getProposalStateSnapshot(id: string): TransactionProposalStateSnapshot | undefined {
    const state = this.#records.get(id);
    return state ? this.#toStateSnapshot(state) : undefined;
  }

  getView(id: string): ControllerTransactionProposalSnapshot | undefined {
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
  }): ReplacePendingDraftRequestResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }
    if (current.status !== "active") {
      return {
        status: "not_pending",
        statusValue: current.status,
      };
    }

    const nextRequestRevision = current.prepare.requestRevision + 1;
    const next = applyTransactionProposalUpdate(current, {
      request: input.request,
      termination: null,
      updatedAt: input.updatedAt,
      prepare: buildPreparingState(nextRequestRevision, input.updatedAt),
    });

    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return {
      status: "updated",
      proposal: this.#toMeta(next),
    };
  }

  updatePreparedForDraft(input: {
    id: string;
    expectedRequestRevision: number;
    updatedAt: number;
    prepared: TransactionPrepared | null;
  }): UpdatePreparedForDraftResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }

    const expectedRequestRevision = input.expectedRequestRevision;
    if (current.prepare.requestRevision !== expectedRequestRevision) {
      return {
        status: "stale",
        requestRevision: current.prepare.requestRevision,
      };
    }
    if (!canPrepareProposal(current)) {
      return {
        status: "not_preparable",
        statusValue: current.status,
      };
    }

    const next = applyTransactionProposalUpdate(current, {
      updatedAt: input.updatedAt,
      prepare:
        input.prepared === null
          ? buildPreparingState(current.prepare.requestRevision, input.updatedAt)
          : buildReadyState({
              requestRevision: current.prepare.requestRevision,
              updatedAt: input.updatedAt,
              prepared: input.prepared,
              reviewPreparedSnapshot: input.prepared,
            }),
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    return {
      status: "updated",
      proposal: this.#toMeta(next),
    };
  }

  getPreparedForExecution(id: string): TransactionPrepared | null {
    const current = this.#records.get(id);
    return current ? readExecutionPrepared(current) : null;
  }

  getReviewState(id: string): TransactionProposalReviewState | null {
    const proposal = this.#records.get(id);
    if (!proposal || proposal.status === "terminated") {
      return null;
    }

    return toPublicReviewState(proposal.prepare);
  }

  matchesRequestRevision(id: string, requestRevision: number): boolean {
    return this.#records.get(id)?.prepare.requestRevision === requestRevision;
  }

  getOrStartPrepare(input: StartPrepareInput): OpenPrepareResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }
    if (!canPrepareProposal(current)) {
      return {
        status: "not_preparable",
        statusValue: current.status,
      };
    }
    const requestRevision = input.requestRevision;

    const previous = toPublicReviewState(current.prepare);
    const prepare =
      current.prepare.requestRevision === requestRevision && current.prepare.status !== "invalidated"
        ? current.prepare
        : buildPreparingState(requestRevision, input.updatedAt);

    const next =
      prepare === current.prepare
        ? current
        : applyTransactionProposalUpdate(current, {
            updatedAt: input.updatedAt,
            prepare,
          });

    this.#records.set(input.id, next);
    const publicReview = toPublicReviewState(next.prepare);
    if (this.#didReviewStateChange(previous, publicReview)) {
      this.#notifyChanged([input.id]);
    }

    return {
      status: "opened",
      review: publicReview,
    };
  }

  restartPrepare(input: StartPrepareInput): RestartPrepareResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }
    if (!canPrepareProposal(current)) {
      return {
        status: "not_preparable",
        statusValue: current.status,
      };
    }
    const requestRevision = input.requestRevision;

    const next = applyTransactionProposalUpdate(current, {
      updatedAt: input.updatedAt,
      prepare: buildPreparingState(requestRevision, input.updatedAt),
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    const review = toPublicReviewState(next.prepare);
    return {
      status: "restarted",
      review,
    };
  }

  settlePrepareReady(
    input: SettlePrepareInput & {
      executionPrepared: TransactionPrepared;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): SettlePrepareResult {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return this.#rejectPrepareSettlement(input);
    }

    const prepare: TransactionProposalReadyState = {
      requestRevision: current.prepare.requestRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt: input.updatedAt,
      status: "ready",
      prepared: structuredClone(input.executionPrepared),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      updatedAt: input.updatedAt,
      prepare,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    const publicReview = toPublicReviewState(prepare);
    return {
      status: "settled",
      review: publicReview,
    };
  }

  settlePrepareBlocked(
    input: SettlePrepareInput & {
      blocker: TransactionReviewBlocker;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): SettlePrepareResult {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return this.#rejectPrepareSettlement(input);
    }

    const prepare: TransactionProposalBlockedState = {
      requestRevision: current.prepare.requestRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt: input.updatedAt,
      status: "blocked",
      prepared: null,
      blocker: structuredClone(input.blocker),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      updatedAt: input.updatedAt,
      prepare,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    const publicReview = toPublicReviewState(prepare);
    return {
      status: "settled",
      review: publicReview,
    };
  }

  settlePrepareFailed(
    input: SettlePrepareInput & {
      error: TransactionReviewError;
      reviewPreparedSnapshot: TransactionPrepared | null;
    },
  ): SettlePrepareResult {
    const current = this.#requireActiveReview(input);
    if (!current) {
      return this.#rejectPrepareSettlement(input);
    }

    const prepare: TransactionProposalFailedPrepareState = {
      requestRevision: current.prepare.requestRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt: input.updatedAt,
      status: "failed",
      prepared: null,
      error: structuredClone(input.error),
      reviewPreparedSnapshot: structuredClone(input.reviewPreparedSnapshot),
    };

    const next = applyTransactionProposalUpdate(current.proposal, {
      updatedAt: input.updatedAt,
      prepare,
    });
    this.#records.set(input.id, next);
    this.#notifyChanged([input.id]);
    const publicReview = toPublicReviewState(prepare);
    return {
      status: "settled",
      review: publicReview,
    };
  }

  invalidatePrepareFromApproval(
    event: ApprovalFinishedEvent<unknown>,
    updatedAt: number,
  ): TransactionProposalReviewState | null {
    if (event.subject?.kind !== "transaction" || event.terminalReason === "user_approve") {
      return null;
    }

    const current = this.#records.get(event.subject.transactionId);
    if (!current) {
      return null;
    }

    const prepare: TransactionProposalInvalidatedState = {
      requestRevision: current.prepare.requestRevision,
      sessionToken: current.prepare.sessionToken,
      updatedAt,
      status: "invalidated",
      prepared: null,
      error: {
        reason: `approval.${event.terminalReason}`,
        message: event.error?.message ?? "Approval is no longer active.",
        ...(event.error ? { data: event.error } : {}),
      },
      invalidatedBy: event.terminalReason,
    };

    const next = applyTransactionProposalUpdate(current, {
      updatedAt,
      prepare,
    });
    this.#records.set(event.subject.transactionId, next);
    this.#notifyChanged([event.subject.transactionId]);
    return toPublicReviewState(prepare);
  }

  approvePendingProposal(input: { id: string; updatedAt: number }): ApprovePendingProposalResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }
    if (current.status !== "active") {
      return {
        status: "not_pending",
        statusValue: current.status,
      };
    }

    const prepare = current.prepare;
    switch (prepare.status) {
      case "preparing":
        return {
          status: "prepare_not_ready",
          prepareState: "preparing",
        };
      case "blocked":
        return {
          status: "prepare_blocked",
          blocker: structuredClone(prepare.blocker),
        };
      case "failed":
        return {
          status: "prepare_failed",
          prepareState: "failed",
          error: structuredClone(prepare.error),
        };
      case "invalidated":
        return {
          status: "prepare_failed",
          prepareState: "invalidated",
          error: structuredClone(prepare.error),
        };
      case "ready":
        break;
    }

    const prepared = readExecutionPrepared(current);
    if (prepared === null) {
      throw new Error(`Transaction ${input.id} reached ready prepare state without execution prepared params.`);
    }

    const next = applyTransactionProposalUpdate(current, {
      status: "approved",
      updatedAt: input.updatedAt,
    });

    this.#records.set(input.id, next);
    this.#emitStatusChange(current, next);
    this.#notifyChanged([input.id]);
    return {
      status: "approved",
      proposal: this.#toMeta(next),
      prepared,
    };
  }

  failProposal(input: {
    id: string;
    updatedAt: number;
    error: TransactionError | null;
    terminationReason: TransactionProposalTerminationReason;
  }): FailProposalResult {
    const current = this.#records.get(input.id);
    if (!current) {
      return { status: "not_found" };
    }
    if (current.status === "terminated") {
      return {
        status: "not_active",
        statusValue: current.status,
      };
    }

    const next = applyTransactionProposalUpdate(current, {
      status: "terminated",
      termination: {
        reason: input.terminationReason,
        error: structuredClone(input.error),
        userRejected: isUserRejectedTermination(input.terminationReason),
      },
      updatedAt: input.updatedAt,
    });

    this.#records.set(input.id, next);
    this.#emitStatusChange(current, next);
    this.#notifyChanged([input.id]);
    return {
      status: "failed",
      proposal: this.#toMeta(next),
    };
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
      .filter((record) => record.status === "approved")
      .map((record) => record.id);
  }

  clearProposalAfterRecordPersisted(id: string): ClearProposalAfterRecordPersistedResult {
    const current = this.#records.get(id);
    if (!current) {
      return { status: "not_found" };
    }
    if (current.status !== "approved") {
      return {
        status: "not_approved",
        statusValue: current.status,
      };
    }

    this.#records.delete(id);
    this.#notifyChanged([id]);
    return {
      status: "cleared",
      proposal: this.#toMeta(current),
    };
  }

  #toMeta(state: TransactionProposalState): TransactionProposalMeta {
    const from = this.#requireFromAddress(state);
    return structuredClone({
      id: state.id,
      approvalId: state.approvalId,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      from,
      ...(state.requestedAddress ? { requestedAddress: state.requestedAddress } : {}),
      request: state.request,
      prepared: readExecutionPrepared(state),
      status: state.status,
      ...(state.termination ? { termination: state.termination } : {}),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
  }

  #toPrepareSnapshot(state: TransactionProposalState): TransactionProposalPrepareSnapshot {
    const prepared = readExecutionPrepared(state);

    switch (state.prepare.status) {
      case "preparing":
        return {
          requestRevision: state.prepare.requestRevision,
          sessionToken: state.prepare.sessionToken,
          status: "preparing",
          prepared,
          reviewSnapshot: null,
        };
      case "ready":
        return {
          requestRevision: state.prepare.requestRevision,
          sessionToken: state.prepare.sessionToken,
          status: "ready",
          prepared,
          reviewSnapshot: structuredClone(state.prepare.reviewPreparedSnapshot),
        };
      case "blocked":
        return {
          requestRevision: state.prepare.requestRevision,
          sessionToken: state.prepare.sessionToken,
          status: "blocked",
          prepared,
          reviewSnapshot: structuredClone(state.prepare.reviewPreparedSnapshot),
          blocker: structuredClone(state.prepare.blocker),
        };
      case "failed":
        return {
          requestRevision: state.prepare.requestRevision,
          sessionToken: state.prepare.sessionToken,
          status: "failed",
          prepared,
          reviewSnapshot: structuredClone(state.prepare.reviewPreparedSnapshot),
          error: structuredClone(state.prepare.error),
        };
      case "invalidated":
        return {
          requestRevision: state.prepare.requestRevision,
          sessionToken: state.prepare.sessionToken,
          status: "invalidated",
          prepared,
          reviewSnapshot: null,
          error: structuredClone(state.prepare.error),
          invalidatedBy: state.prepare.invalidatedBy,
        };
    }
  }

  #toStateSnapshot(state: TransactionProposalState): TransactionProposalStateSnapshot {
    const from = this.#requireFromAddress(state);
    return {
      id: state.id,
      approvalId: state.approvalId,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      from,
      ...(state.requestedAddress ? { requestedAddress: state.requestedAddress } : {}),
      request: structuredClone(state.request),
      fromAccountKey: state.fromAccountKey,
      status: state.status,
      ...(state.termination ? { termination: structuredClone(state.termination) } : {}),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      prepare: this.#toPrepareSnapshot(state),
    };
  }

  #buildProposalView(state: TransactionProposalState): ControllerTransactionProposalSnapshot {
    const from = this.#requireFromAddress(state);
    return structuredClone({
      kind: "proposal",
      id: state.id,
      approvalId: state.approvalId,
      namespace: state.namespace,
      chainRef: state.chainRef,
      origin: state.origin,
      from,
      ...(state.requestedAddress ? { requestedAddress: state.requestedAddress } : {}),
      request: state.request,
      prepared: readExecutionPrepared(state),
      status: state.status,
      ...(state.termination ? { termination: structuredClone(state.termination) } : {}),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
  }

  #emitStatusChange(previous: TransactionProposalState, next: TransactionProposalState) {
    if (previous.status === next.status) {
      return;
    }

    const proposal = this.#buildProposalView(next);
    const payload: TransactionProposalStatusChange = {
      kind: "proposal_status",
      id: next.id,
      previousStatus: previous.status,
      nextStatus: next.status,
      proposal,
    };
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
  }

  #requireActiveReview(input: SettlePrepareInput): {
    proposal: TransactionProposalState;
    prepare: TransactionProposalPrepareState;
  } | null {
    const expectedRequestRevision = input.expectedRequestRevision;
    const proposal = this.#records.get(input.id);
    const prepare = proposal?.prepare;
    if (
      !proposal ||
      !prepare ||
      prepare.requestRevision !== expectedRequestRevision ||
      prepare.sessionToken !== input.sessionToken ||
      prepare.status === "invalidated"
    ) {
      return null;
    }

    return { proposal, prepare };
  }

  #rejectPrepareSettlement(input: SettlePrepareInput): SettlePrepareResult {
    const proposal = this.#records.get(input.id);
    if (!proposal) {
      return { status: "not_found" };
    }

    const expectedRequestRevision = input.expectedRequestRevision;

    const prepare = proposal.prepare;
    if (prepare.requestRevision !== expectedRequestRevision) {
      return {
        status: "stale",
        requestRevision: proposal.prepare.requestRevision,
        sessionToken: prepare.sessionToken,
      };
    }

    if (prepare.status === "invalidated") {
      return {
        status: "invalidated",
        invalidatedBy: prepare.invalidatedBy,
      };
    }

    if (prepare.sessionToken !== input.sessionToken) {
      return {
        status: "stale",
        requestRevision: prepare.requestRevision,
        sessionToken: prepare.sessionToken,
      };
    }

    return {
      status: "stale",
      requestRevision: prepare.requestRevision,
      sessionToken: prepare.sessionToken,
    };
  }

  #requireFromAddress(state: Pick<TransactionProposalState, "id" | "fromAccountKey">): string {
    try {
      return this.#accountCodecs.toCanonicalAddressFromAccountKey({ accountKey: state.fromAccountKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Transaction proposal ${state.id} has an invalid fromAccountKey ${state.fromAccountKey}: ${message}`,
      );
    }
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
