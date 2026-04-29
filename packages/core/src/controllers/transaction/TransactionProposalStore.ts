import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionMeta,
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
  baseRequest: TransactionMeta["request"];
  request: TransactionMeta["request"];
  prepared: TransactionMeta["prepared"];
  preparedAtDraftRevision: number | null;
  phase: TransactionProposalPhase;
  submitted: TransactionMeta["submitted"];
  locator: TransactionMeta["locator"];
  receipt: TransactionMeta["receipt"];
  replacedId: TransactionMeta["replacedId"];
  error: TransactionMeta["error"];
  userRejected: boolean;
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
  | "submitted"
  | "locator"
  | "receipt"
  | "replacedId"
  | "error"
  | "userRejected"
  | "draftRevision"
> & {
  approvalId?: string | undefined;
  baseRequest?: TransactionMeta["request"] | undefined;
  prepared?: TransactionMeta["prepared"] | undefined;
  preparedAtDraftRevision?: number | null | undefined;
  submitted?: TransactionMeta["submitted"] | undefined;
  locator?: TransactionMeta["locator"] | undefined;
  receipt?: TransactionMeta["receipt"] | undefined;
  replacedId?: TransactionMeta["replacedId"] | undefined;
  error?: TransactionMeta["error"] | undefined;
  userRejected?: boolean | undefined;
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
  Pick<
    TransactionProposalState,
    "prepared" | "submitted" | "locator" | "receipt" | "replacedId" | "error" | "userRejected"
  >
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
  submitted: structuredClone(input.submitted ?? null),
  locator: structuredClone(input.locator ?? null),
  receipt: structuredClone(input.receipt ?? null),
  replacedId: input.replacedId ?? null,
  error: structuredClone(input.error ?? null),
  userRejected: input.userRejected ?? false,
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
  if (patch.submitted !== undefined) {
    next.submitted = structuredClone(patch.submitted);
  }
  if (patch.locator !== undefined) {
    next.locator = structuredClone(patch.locator);
  }
  if (patch.receipt !== undefined) {
    next.receipt = structuredClone(patch.receipt);
  }
  if (patch.replacedId !== undefined) {
    next.replacedId = patch.replacedId;
  }
  if (patch.error !== undefined) {
    next.error = structuredClone(patch.error);
  }

  return next;
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

  createPendingProposal(input: TransactionProposalInit): TransactionMeta {
    const next = buildTransactionProposalState(input);
    this.#records.set(next.id, next);
    this.#scheduleStateChanged(next.id);
    return this.#toMeta(next);
  }

  get(id: string): TransactionMeta | undefined {
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

  patch(id: string, patch: TransactionProposalPatch): TransactionMeta | null {
    const current = this.#records.get(id);
    if (!current) return null;

    const next = applyTransactionProposalPatch(current, patch);

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#scheduleStateChanged(id);
    return this.#toMeta(next);
  }

  replacePendingDraftRequest(input: {
    id: string;
    request: TransactionRequest;
    updatedAt: number;
  }): TransactionMeta | null {
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
    prepared: TransactionMeta["prepared"],
  ): TransactionMeta | null {
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

  hasCurrentPrepared(id: string): boolean {
    const current = this.#records.get(id);
    return Boolean(current?.prepared && current.preparedAtDraftRevision === current.draftRevision);
  }

  approvePendingProposal(input: { id: string; updatedAt: number }): TransactionMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: "pending",
      next: "approved",
      updatedAt: input.updatedAt,
    });
  }

  startExecution(input: { id: string; updatedAt: number }): TransactionMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: "approved",
      next: "executing",
      updatedAt: input.updatedAt,
    });
  }

  failProposalBeforeBroadcast(input: {
    id: string;
    updatedAt: number;
    patch?: TransactionProposalTransitionPatch | undefined;
  }): TransactionMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: ["pending", "approved", "executing"],
      next: "failed",
      updatedAt: input.updatedAt,
      patch: input.patch,
    });
  }

  failExecutingProposal(input: {
    id: string;
    updatedAt: number;
    patch?: TransactionProposalTransitionPatch | undefined;
  }): TransactionMeta | null {
    return this.#moveProposal({
      id: input.id,
      expected: "executing",
      next: "failed",
      updatedAt: input.updatedAt,
      patch: input.patch,
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

  clearProposalAfterRecordPersisted(id: string): TransactionMeta | null {
    const current = this.#records.get(id);
    if (!current || current.phase !== "executing") {
      return null;
    }

    this.#records.delete(id);
    this.#scheduleStateChanged(id);
    return this.#toMeta(current);
  }

  #toMeta(state: TransactionProposalState): TransactionMeta {
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
      submitted: state.submitted,
      locator: state.locator,
      receipt: state.receipt,
      replacedId: state.replacedId,
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
      review: {
        updatedAt: state.updatedAt,
        namespaceReview: null,
        prepare: state.prepared
          ? { state: "ready" }
          : state.phase === "failed" && state.error
            ? {
                state: "failed",
                error: {
                  reason: state.error.name || "transaction.failed",
                  message: state.error.message || "Transaction failed.",
                  ...(state.error.data !== undefined ? { data: state.error.data } : {}),
                },
              }
            : { state: "preparing" },
      },
      phase: state.phase,
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
      meta: this.#toMeta(next),
    };
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
  }

  #moveProposal(input: {
    id: string;
    expected: TransactionProposalPhase | readonly TransactionProposalPhase[];
    next: TransactionProposalPhase;
    updatedAt: number;
    patch?: TransactionProposalTransitionPatch | undefined;
  }): TransactionMeta | null {
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
