import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionError, TransactionPrepared, TransactionRequest } from "../../transactions/types.js";
import { canPrepareProposal } from "./status.js";
import { TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  TransactionProposalMeta,
  TransactionProposalPhase,
  TransactionProposalPhaseChange,
  TransactionProposalSnapshot,
} from "./types.js";

export type TransactionProposalState = {
  id: string;
  approvalId: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  request: TransactionRequest;
  prepared: TransactionPrepared | null;
  preparedAtDraftRevision: number | null;
  phase: TransactionProposalPhase;
  error: TransactionError | null;
  userRejected: boolean;
  draftRevision: number;
  createdAt: number;
  updatedAt: number;
};

type TransactionProposalInit = Omit<
  TransactionProposalState,
  "approvalId" | "prepared" | "preparedAtDraftRevision" | "phase" | "error" | "userRejected" | "draftRevision"
> & {
  approvalId?: string | undefined;
  prepared?: TransactionPrepared | null | undefined;
  preparedAtDraftRevision?: number | null | undefined;
  error?: TransactionError | null | undefined;
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
  request: structuredClone(input.request),
  prepared: structuredClone(input.prepared ?? null),
  preparedAtDraftRevision: input.prepared
    ? (input.preparedAtDraftRevision ?? input.draftRevision ?? 0)
    : (input.preparedAtDraftRevision ?? null),
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
  if (patch.error !== undefined) {
    next.error = structuredClone(patch.error);
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

  patch(id: string, patch: TransactionProposalPatch): TransactionProposalMeta | null {
    const current = this.#records.get(id);
    if (!current) return null;

    const next = applyTransactionProposalPatch(current, patch);

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#notifyChanged([id]);
    return this.#toMeta(next);
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
    this.#notifyChanged([input.id]);
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
    this.#notifyChanged([id]);
    return this.#toMeta(next);
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
      prepared: state.prepared,
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
      prepared: state.prepared,
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
}
