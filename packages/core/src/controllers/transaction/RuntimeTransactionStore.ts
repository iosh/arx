import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { isPrepareEligibleTransactionStatus } from "./status.js";
import { TRANSACTION_STATE_CHANGED, TRANSACTION_STATUS_CHANGED, type TransactionMessenger } from "./topics.js";
import type {
  DurableTransactionStatus,
  TransactionMeta,
  TransactionRequest,
  TransactionStateChange,
  TransactionStatus,
  TransactionStatusChange,
} from "./types.js";

export type RuntimeTransactionState = {
  id: string;
  namespace: string;
  chainRef: string;
  origin: string;
  fromAccountKey: string;
  request: TransactionMeta["request"];
  prepared: TransactionMeta["prepared"];
  status: TransactionStatus;
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

type RuntimeTransactionInit = Omit<
  RuntimeTransactionState,
  "prepared" | "submitted" | "locator" | "receipt" | "replacedId" | "error" | "userRejected" | "draftRevision"
> & {
  prepared?: TransactionMeta["prepared"] | undefined;
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

const isDurableStatus = (status: TransactionStatus): status is DurableTransactionStatus => {
  return status === "broadcast" || status === "confirmed" || status === "failed" || status === "replaced";
};

type RuntimeTransactionPatch = Partial<
  Omit<
    RuntimeTransactionState,
    "id" | "namespace" | "chainRef" | "origin" | "fromAccountKey" | "draftRevision" | "createdAt"
  >
>;

type RuntimeTransactionTransitionPatch = Partial<
  Pick<
    RuntimeTransactionState,
    "prepared" | "submitted" | "locator" | "receipt" | "replacedId" | "error" | "userRejected"
  >
>;

const buildRuntimeTransactionState = (
  input: RuntimeTransactionInit | RuntimeTransactionState,
): RuntimeTransactionState => ({
  ...input,
  request: structuredClone(input.request),
  prepared: structuredClone(input.prepared ?? null),
  submitted: structuredClone(input.submitted ?? null),
  locator: structuredClone(input.locator ?? null),
  receipt: structuredClone(input.receipt ?? null),
  replacedId: input.replacedId ?? null,
  error: structuredClone(input.error ?? null),
  userRejected: input.userRejected ?? false,
  draftRevision: input.draftRevision ?? 0,
});

const applyRuntimeTransactionPatch = (
  current: RuntimeTransactionState,
  patch: RuntimeTransactionPatch,
): RuntimeTransactionState => {
  const next: RuntimeTransactionState = {
    ...current,
    ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.userRejected !== undefined ? { userRejected: patch.userRejected } : {}),
  };

  if (patch.request) {
    next.request = structuredClone(patch.request);
  }
  if (patch.prepared !== undefined) {
    next.prepared = structuredClone(patch.prepared);
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

export class RuntimeTransactionStore {
  #messenger: TransactionMessenger;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #records = new Map<string, RuntimeTransactionState>();
  #stateRevision = 0;
  #statePublishScheduled = false;
  #pendingStateChangeIds = new Set<string>();

  constructor({ messenger, accountCodecs }: Options) {
    this.#messenger = messenger;
    this.#accountCodecs = accountCodecs;
  }

  create(input: RuntimeTransactionInit): TransactionMeta {
    const next = buildRuntimeTransactionState(input);
    this.#records.set(next.id, next);
    this.#scheduleStateChanged(next.id);
    return this.#toMeta(next);
  }

  get(id: string): TransactionMeta | undefined {
    const state = this.#records.get(id);
    return state ? this.#toMeta(state) : undefined;
  }

  peek(id: string): RuntimeTransactionState | undefined {
    return this.#records.get(id);
  }

  patch(id: string, patch: RuntimeTransactionPatch): TransactionMeta | null {
    const current = this.#records.get(id);
    if (!current) return null;

    const next = applyRuntimeTransactionPatch(current, patch);

    this.#records.set(id, next);
    this.#emitStatusChange(current, next);
    this.#scheduleStateChanged(id);
    return this.#toMeta(next);
  }

  replaceDraftRequest(input: {
    id: string;
    fromStatus: "pending";
    request: TransactionRequest;
    updatedAt: number;
  }): TransactionMeta | null {
    const current = this.#records.get(input.id);
    if (!current || current.status !== input.fromStatus) return null;

    const next = applyRuntimeTransactionPatch(current, {
      request: input.request,
      prepared: null,
      error: null,
      updatedAt: input.updatedAt,
    });
    next.draftRevision = current.draftRevision + 1;

    this.#records.set(input.id, next);
    this.#scheduleStateChanged(input.id);
    return this.#toMeta(next);
  }

  resetSignedToApproved(id: string, updatedAt: number): TransactionMeta | null {
    const current = this.#records.get(id);
    if (!current) return null;

    return this.transition({
      id,
      fromStatus: "signed",
      toStatus: "approved",
      updatedAt,
    });
  }

  commitPrepared(
    id: string,
    expectedDraftRevision: number,
    prepared: TransactionMeta["prepared"],
  ): TransactionMeta | null {
    const current = this.#records.get(id);
    if (
      !current ||
      current.draftRevision !== expectedDraftRevision ||
      !isPrepareEligibleTransactionStatus(current.status)
    ) {
      return null;
    }

    return this.patch(id, { prepared });
  }

  transition(input: {
    id: string;
    fromStatus: TransactionStatus | readonly TransactionStatus[];
    toStatus: TransactionStatus;
    updatedAt: number;
    patch?: RuntimeTransactionTransitionPatch | undefined;
  }): TransactionMeta | null {
    const current = this.#records.get(input.id);
    if (!current) return null;

    const expected = Array.isArray(input.fromStatus) ? input.fromStatus : [input.fromStatus];
    if (!expected.includes(current.status)) {
      return null;
    }

    return this.patch(input.id, {
      status: input.toStatus,
      updatedAt: input.updatedAt,
      ...(input.patch ?? {}),
    });
  }

  delete(id: string): boolean {
    const deleted = this.#records.delete(id);
    if (deleted) {
      this.#scheduleStateChanged(id);
    }
    return deleted;
  }

  listExecutableIds(): string[] {
    return Array.from(this.#records.values())
      .filter((record) => record.status === "approved")
      .map((record) => record.id);
  }

  markDurablySubmitted(id: string): TransactionMeta | null {
    const current = this.#records.get(id);
    if (!current || !isDurableStatus(current.status)) {
      return null;
    }

    this.#records.delete(id);
    this.#scheduleStateChanged(id);
    return this.#toMeta(current);
  }

  #toMeta(state: RuntimeTransactionState): TransactionMeta {
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
      status: state.status,
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

  #emitStatusChange(previous: RuntimeTransactionState, next: RuntimeTransactionState) {
    if (previous.status === next.status) {
      return;
    }

    const payload: TransactionStatusChange = {
      id: next.id,
      previousStatus: previous.status,
      nextStatus: next.status,
      meta: this.#toMeta(next),
    };
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED, payload);
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
