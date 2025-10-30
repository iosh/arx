import type { TransactionAdapterRegistry } from "../../transactions/adapters/registry.js";
import type { TransactionAdapterContext, TransactionDraft } from "../../transactions/adapters/types.js";
import type { AccountAddress, AccountController } from "../account/types.js";
import { type ApprovalController, type ApprovalStrategy, ApprovalTypes } from "../approval/types.js";
import type { NetworkController } from "../network/types.js";
import type {
  TransactionApprovalTask,
  TransactionApprovalTaskPayload,
  TransactionController,
  TransactionControllerOptions,
  TransactionDraftPreview,
  TransactionError,
  TransactionIssue,
  TransactionMessenger,
  TransactionMeta,
  TransactionRequest,
  TransactionState,
  TransactionStatusChange,
  TransactionWarning,
} from "./types.js";

const TRANSACTION_STATUS_CHANGED_TOPIC = "transaction:statusChanged";
const TRANSACTION_STATE_TOPIC = "transaction:stateChanged";
const TRANSACTION_QUEUED_TOPIC = "transaction:queued";

const DEFAULT_REJECTION_MESSAGE = "Transaction rejected by stub";

const defaultIdGenerator = () => {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

const cloneRequest = (request: TransactionRequest): TransactionRequest => {
  if (request.namespace === "eip155") {
    return {
      ...request,
      payload: { ...request.payload },
    };
  }
  return {
    ...request,
    payload: { ...(request.payload as Record<string, unknown>) },
  };
};

const cloneMeta = (meta: TransactionMeta): TransactionMeta => ({
  ...meta,
  request: cloneRequest(meta.request),
});

const cloneState = (state: TransactionState): TransactionState => ({
  pending: state.pending.map(cloneMeta),
  history: state.history.map(cloneMeta),
});

const isSameState = (prev?: TransactionState, next?: TransactionState) => {
  if (!prev || !next) return false;
  if (prev.pending.length !== next.pending.length) return false;
  if (prev.history.length !== next.history.length) return false;

  return (
    prev.pending.every(
      (meta, index) => meta.id === next.pending[index]?.id && meta.updatedAt === next.pending[index]?.updatedAt,
    ) &&
    prev.history.every(
      (meta, index) => meta.id === next.history[index]?.id && meta.updatedAt === next.history[index]?.updatedAt,
    )
  );
};

export class InMemoryTransactionController implements TransactionController {
  #messenger: TransactionMessenger;
  #network: Pick<NetworkController, "getActiveChain">;
  #accounts: Pick<AccountController, "getActivePointer">;
  #approvals: Pick<ApprovalController, "requestApproval">;
  #generateId: () => string;
  #now: () => number;
  #autoApprove: boolean;
  #autoRejectMessage: string;
  #state: TransactionState;

  #registry: TransactionAdapterRegistry;
  #queue: string[];
  #processing: Set<string>;
  #scheduled: boolean;
  #drafts: Map<string, TransactionDraft>;

  constructor({
    messenger,
    network,
    accounts,
    approvals,
    registry,
    idGenerator,
    now,
    autoApprove = false,
    autoRejectMessage = DEFAULT_REJECTION_MESSAGE,
    initialState,
  }: TransactionControllerOptions) {
    this.#messenger = messenger;
    this.#network = network;
    this.#accounts = accounts;
    this.#approvals = approvals;
    this.#registry = registry;
    this.#generateId = idGenerator ?? defaultIdGenerator;
    this.#now = now ?? Date.now;
    this.#autoApprove = autoApprove;
    this.#autoRejectMessage = autoRejectMessage;
    this.#state = cloneState(initialState ?? { pending: [], history: [] });
    this.#queue = [];
    this.#processing = new Set();
    this.#scheduled = false;
    this.#drafts = new Map();
    this.#publishState();
  }

  getState(): TransactionState {
    return cloneState(this.#state);
  }

  getMeta(id: string): TransactionMeta | undefined {
    return this.#state.history.find((meta) => meta.id === id) ?? this.#state.pending.find((meta) => meta.id === id);
  }

  async submitTransaction(origin: string, request: TransactionRequest): Promise<TransactionMeta> {
    const activeChain = this.#network.getActiveChain();
    if (!activeChain) {
      throw new Error("Active chain is required for transactions");
    }

    const resolvedCaip2 = request.caip2 ?? activeChain.chainRef;
    const adapter = this.#registry.get(request.namespace);

    const id = this.#generateId();
    const timestamp = this.#now();
    const fromAddress = this.#resolveFrom(request) ?? this.#accounts.getActivePointer()?.address ?? null;

    const meta: TransactionMeta = {
      id,
      namespace: request.namespace,
      caip2: resolvedCaip2,
      origin,
      from: fromAddress,
      request: cloneRequest({ ...request, caip2: resolvedCaip2 }),
      status: "pending",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#state = {
      pending: [...this.#state.pending, meta],
      history: [...this.#state.history],
    };

    this.#publishState();
    this.#publishQueued(meta);

    let draftPreview: TransactionDraftPreview | null = null;
    let collectedWarnings: TransactionWarning[] = [];
    let collectedIssues: TransactionIssue[] = [];

    if (adapter) {
      try {
        const draftContext = this.#buildContext(meta);
        const draft = await adapter.buildDraft(draftContext);
        collectedWarnings = this.#cloneWarnings(draft.warnings);
        collectedIssues = this.#cloneIssues(draft.issues);
        draftPreview = this.#buildPreviewFromDraft(draft);
        this.#drafts.set(meta.id, draft);
      } catch (error) {
        const issue = this.#issueFromDraftError(error);
        collectedIssues = [issue];
        draftPreview = this.#buildPreviewFromIssue(issue, { stage: "draft" });
        this.#drafts.delete(meta.id);
      }
    } else {
      const issue = this.#missingAdapterIssue(request.namespace);
      collectedIssues = [issue];
      draftPreview = this.#buildPreviewFromIssue(issue, { namespace: request.namespace });
      this.#drafts.delete(meta.id);
    }

    this.#updateMeta(meta.id, {
      warnings: this.#cloneWarnings(collectedWarnings),
      issues: this.#cloneIssues(collectedIssues),
    });

    const latestMeta = this.getMeta(meta.id) ?? meta;
    const task = this.#createApprovalTask(latestMeta, draftPreview);

    const strategy: ApprovalStrategy<TransactionApprovalTaskPayload, TransactionMeta> = async () => {
      if (this.#autoApprove) {
        const approved = await this.approveTransaction(id);
        if (!approved) {
          throw new Error(`Transaction ${id} could not be approved`);
        }
        return approved;
      }

      await this.rejectTransaction(id, new Error(this.#autoRejectMessage));
      const rejection = Object.assign(new Error(this.#autoRejectMessage), {
        name: "TransactionRejectedError",
      });
      throw rejection;
    };

    return this.#approvals.requestApproval(task, strategy);
  }

  async approveTransaction(id: string): Promise<TransactionMeta | null> {
    const index = this.#state.pending.findIndex((meta) => meta.id === id);
    if (index === -1) {
      return null;
    }
    const now = this.#now();
    const current = this.#state.pending[index]!;
    const updated: TransactionMeta = {
      ...cloneMeta(current),
      status: "approved",
      updatedAt: now,
    };

    const nextPending = [...this.#state.pending];
    nextPending.splice(index, 1);
    const nextHistory = [...this.#state.history, updated];

    this.#state = { pending: nextPending, history: nextHistory };
    this.#publishState();
    this.#publishStatusChange(current, updated);
    this.#enqueue(updated.id);
    return updated;
  }

  async processTransaction(id: string): Promise<void> {
    const meta = this.getMeta(id);
    if (!meta) return;

    if (!["approved", "signed"].includes(meta.status)) {
      return;
    }

    const adapter = this.#registry.get(meta.namespace);
    if (!adapter) {
      await this.rejectTransaction(id, new Error(`No transaction adapter registered for namespace ${meta.namespace}`));
      return;
    }

    let context = this.#buildContext(meta);

    try {
      let draft = this.#drafts.get(id);
      if (!draft) {
        draft = await adapter.buildDraft(context);
        this.#drafts.set(id, draft);
        this.#updateMeta(id, {
          warnings: this.#cloneWarnings(draft.warnings),
          issues: this.#cloneIssues(draft.issues),
        });

        const refreshed = this.getMeta(id);
        if (!refreshed) return;
        context = this.#buildContext(refreshed);
      }

      const signed = await adapter.signTransaction(context, draft);
      this.#updateMeta(id, {
        status: "signed",
        hash: signed.hash ?? null,
      });

      const afterSign = this.getMeta(id);
      if (!afterSign) return;
      context = this.#buildContext(afterSign);

      const broadcast = await adapter.broadcastTransaction(context, signed);
      this.#updateMeta(id, {
        status: "broadcast",
        hash: broadcast.hash,
      });
      this.#drafts.delete(id);
    } catch (err) {
      this.#drafts.delete(id);
      await this.rejectTransaction(id, err instanceof Error ? err : new Error("Transaction processing failed"));
    }
  }
  async rejectTransaction(id: string, reason?: Error | TransactionError): Promise<void> {
    const now = this.#now();
    const error = this.#normalizeError(reason);
    const isUserRejected = error?.code === 4001 || error?.name === "TransactionRejectedError";

    const pendingIndex = this.#state.pending.findIndex((meta) => meta.id === id);
    if (pendingIndex > -1) {
      const current = this.#state.pending[pendingIndex]!;
      const updated: TransactionMeta = {
        ...cloneMeta(current),
        status: "failed",
        error,
        userRejected: isUserRejected,
        updatedAt: now,
      };

      const nextPending = [...this.#state.pending];
      nextPending.splice(pendingIndex, 1);
      const nextHistory = [...this.#state.history, updated];

      this.#state = { pending: nextPending, history: nextHistory };
      this.#publishState();
      this.#publishStatusChange(current, updated);
      return;
    }

    const historyIndex = this.#state.history.findIndex((meta) => meta.id === id);
    if (historyIndex === -1) {
      return;
    }

    const current = this.#state.history[historyIndex]!;
    const next = {
      ...cloneMeta(current),
      status: "failed",
      error,
      userRejected: isUserRejected,
      updatedAt: now,
    } satisfies TransactionMeta;

    const nextHistory = [...this.#state.history];
    nextHistory[historyIndex] = next;

    this.#state = { pending: [...this.#state.pending], history: nextHistory };
    this.#publishState();
    this.#publishStatusChange(current, next);

    this.#drafts.delete(id);
  }

  onStateChanged(handler: (state: TransactionState) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATE_TOPIC, handler);
  }

  onStatusChanged(handler: (meta: TransactionStatusChange) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_STATUS_CHANGED_TOPIC, handler);
  }

  onQueued(handler: (meta: TransactionMeta) => void): () => void {
    return this.#messenger.subscribe(TRANSACTION_QUEUED_TOPIC, handler);
  }

  async resumePending(): Promise<void> {
    // Only resume transactions that already passed approval; fresh submissions stay in pending.
    const resolvable = [...this.#state.pending, ...this.#state.history].filter((meta) =>
      ["approved", "signed"].includes(meta.status),
    );
    for (const meta of resolvable) {
      this.#enqueue(meta.id);
    }
  }

  hydrate(state: TransactionState): void {
    this.#state = cloneState(state);
    this.#publishState();
  }

  replaceState(state: TransactionState): void {
    this.hydrate(state);
  }

  #createApprovalTask(meta: TransactionMeta, draft: TransactionDraftPreview | null): TransactionApprovalTask {
    const warningsSource = draft?.warnings ?? meta.warnings;
    const issuesSource = draft?.issues ?? meta.issues;

    return {
      id: meta.id,
      type: ApprovalTypes.SendTransaction,
      origin: meta.origin,
      namespace: meta.request.namespace,
      chainRef: meta.caip2,
      payload: {
        caip2: meta.caip2,
        origin: meta.origin,
        request: cloneRequest(meta.request),
        draft: draft ? this.#cloneDraftPreview(draft) : null,
        warnings: this.#cloneWarnings(warningsSource),
        issues: this.#cloneIssues(issuesSource),
      },
    };
  }

  #resolveFrom(request: TransactionRequest): AccountAddress | null {
    const payload = request.payload;
    if (payload && typeof payload === "object") {
      const candidate = (payload as { from?: unknown }).from;
      if (typeof candidate === "string") {
        return candidate as AccountAddress;
      }
    }
    return null;
  }

  #publishState() {
    this.#messenger.publish(TRANSACTION_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishQueued(meta: TransactionMeta) {
    this.#messenger.publish(TRANSACTION_QUEUED_TOPIC, cloneMeta(meta), {
      compare: (prev, next) => prev?.id === next?.id && prev?.updatedAt === next?.updatedAt,
    });
  }

  #enqueue(id: string) {
    if (this.#processing.has(id) || this.#queue.includes(id)) {
      return;
    }
    this.#queue.push(id);
    this.#scheduleProcess();
  }

  #scheduleProcess() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#processQueue();
    });
  }

  async #processQueue() {
    const next = this.#queue.shift();
    if (!next) return;
    if (this.#processing.has(next)) {
      return this.#scheduleProcess();
    }
    this.#processing.add(next);
    try {
      await this.processTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) {
        this.#scheduleProcess();
      }
    }
  }

  #normalizeError(reason?: Error | TransactionError | null): TransactionError | null {
    if (!reason) return null;
    if ("name" in reason && "message" in reason && typeof reason.name === "string") {
      const error: TransactionError = {
        name: reason.name,
        message: reason.message ?? "",
      };
      if ("code" in reason && typeof reason.code === "number") {
        error.code = reason.code;
      }
      if ("data" in reason) {
        error.data = reason.data;
      }
      return error;
    }
    return {
      name: "Error",
      message: String(reason),
    };
  }

  #publishStatusChange(previous: TransactionMeta, next: TransactionMeta) {
    if (previous.status === next.status) {
      return;
    }
    this.#messenger.publish(TRANSACTION_STATUS_CHANGED_TOPIC, {
      id: next.id,
      previousStatus: previous.status,
      nextStatus: next.status,
      meta: cloneMeta(next),
    });
  }

  #updateMeta(id: string, updates: Partial<TransactionMeta>) {
    const now = this.#now();
    const inPending = this.#state.pending.findIndex((item) => item.id === id);
    if (inPending > -1) {
      const current = this.#state.pending[inPending]!;
      const next = { ...cloneMeta(current), ...updates, updatedAt: updates.updatedAt ?? now };
      this.#state.pending[inPending] = next;
      this.#publishState();
      this.#publishStatusChange(current, next);
      return;
    }
    const inHistory = this.#state.history.findIndex((item) => item.id === id);
    if (inHistory > -1) {
      const current = this.#state.history[inHistory]!;
      const next = { ...cloneMeta(current), ...updates, updatedAt: updates.updatedAt ?? now };
      this.#state.history[inHistory] = next;
      this.#publishState();
      this.#publishStatusChange(current, next);
    }
  }

  #buildContext(meta: TransactionMeta): TransactionAdapterContext {
    return {
      namespace: meta.namespace,
      chainRef: meta.caip2,
      origin: meta.origin,
      from: meta.from,
      request: cloneRequest(meta.request),
      meta: cloneMeta(meta),
    };
  }

  #cloneWarnings(list: TransactionWarning[]): TransactionWarning[] {
    return list.map((warning) => ({ ...warning }));
  }

  #cloneIssues(list: TransactionIssue[]): TransactionIssue[] {
    return list.map((issue) => ({ ...issue }));
  }

  #buildPreviewFromDraft(draft: TransactionDraft): TransactionDraftPreview {
    return {
      summary: { ...draft.summary },
      warnings: this.#cloneWarnings(draft.warnings),
      issues: this.#cloneIssues(draft.issues),
    };
  }

  #buildPreviewFromIssue(issue: TransactionIssue, extras?: Record<string, unknown>): TransactionDraftPreview {
    return {
      summary: { code: issue.code, message: issue.message, ...(extras ?? {}) },
      warnings: [],
      issues: this.#cloneIssues([issue]),
    };
  }

  #cloneDraftPreview(preview: TransactionDraftPreview): TransactionDraftPreview {
    return {
      summary: { ...preview.summary },
      warnings: this.#cloneWarnings(preview.warnings),
      issues: this.#cloneIssues(preview.issues),
    };
  }

  #issueFromDraftError(error: unknown): TransactionIssue {
    if (error instanceof Error) {
      return {
        code: "transaction.draft_failed",
        message: error.message,
        data: { name: error.name },
      };
    }
    return {
      code: "transaction.draft_failed",
      message: String(error),
    };
  }

  #missingAdapterIssue(namespace: string): TransactionIssue {
    return {
      code: "transaction.adapter_missing",
      message: `No transaction adapter registered for namespace ${namespace}`,
      data: { namespace },
    };
  }
}
