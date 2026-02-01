import type { ApprovalRecord, FinalStatusReason, RequestContextRecord } from "../../db/records.js";
import type { ApprovalsService } from "../../services/approvals/types.js";
import type {
  ApprovalController,
  ApprovalExecutor,
  ApprovalMessenger,
  ApprovalResult,
  ApprovalState,
  ApprovalTask,
  PendingApproval,
} from "./types.js";

const APPROVAL_STATE_TOPIC = "approval:stateChanged";
const APPROVAL_REQUEST_TOPIC = "approval:requested";
const APPROVAL_FINISH_TOPIC = "approval:finished";

const cloneState = (state: ApprovalState): ApprovalState => ({
  pending: state.pending.map((item) => ({
    id: item.id,
    type: item.type,
    origin: item.origin,
    namespace: item.namespace,
    chainRef: item.chainRef,
    createdAt: item.createdAt,
  })),
});

const isSameState = (prev?: ApprovalState, next?: ApprovalState) => {
  if (!prev || !next) return false;
  if (prev.pending.length !== next.pending.length) return false;

  for (let index = 0; index < prev.pending.length; index += 1) {
    const current = prev.pending[index];
    const other = next.pending[index];
    if (!other || !current) {
      return false;
    }
    const matches =
      current.id === other.id &&
      current.type === other.type &&
      current.origin === other.origin &&
      current.namespace === other.namespace &&
      current.chainRef === other.chainRef &&
      current.createdAt === other.createdAt;

    if (!matches) {
      return false;
    }
  }

  return true;
};
const cloneTask = <T>(task: ApprovalTask<T>): ApprovalTask<T> => ({
  id: task.id,
  type: task.type,
  origin: task.origin,
  namespace: task.namespace,
  chainRef: task.chainRef,
  payload: task.payload,
  createdAt: task.createdAt,
});

const cloneResult = <T>(result: ApprovalResult<T>): ApprovalResult<T> => ({
  id: result.id,
  namespace: result.namespace,
  chainRef: result.chainRef,
  value: result.value,
});

type CreateStoreApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  service: ApprovalsService;
  now?: () => number;
  autoRejectMessage?: string;
  /**
   * Default TTL for approvals persisted in the store.
   * This metadata is currently not used for automatic cleanup.
   */
  ttlMs?: number;
};

const toQueueItem = (record: ApprovalRecord) => ({
  id: record.id,
  type: record.type,
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  createdAt: record.createdAt,
});

const toTask = (record: ApprovalRecord): ApprovalTask<unknown> => ({
  id: record.id,
  type: record.type,
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  payload: record.payload,
  createdAt: record.createdAt,
});

export class StoreApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #service: ApprovalsService;
  #now: () => number;
  #autoRejectMessage: string;
  #ttlMs: number;

  #state: ApprovalState = { pending: [] };
  #tasks: Map<string, ApprovalTask<unknown>> = new Map();
  #pending: Map<string, PendingApproval<unknown>> = new Map();

  #syncPromise: Promise<void> | null = null;
  #syncQueued = false;

  constructor({ messenger, service, now = Date.now, autoRejectMessage, ttlMs }: CreateStoreApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#service = service;
    this.#now = now;
    this.#autoRejectMessage = autoRejectMessage ?? "Approval rejected by stub";
    this.#ttlMs = ttlMs ?? 5 * 60_000;

    this.#service.on("changed", () => {
      void this.#queueSyncFromStore();
    });

    // Best-effort initial sync so UI sees store-backed pending items immediately.
    void this.#queueSyncFromStore();
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_TOPIC, handler);
  }

  onRequest(handler: (task: ApprovalTask<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_REQUEST_TOPIC, handler);
  }

  onFinish(handler: (result: ApprovalResult<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_FINISH_TOPIC, handler);
  }

  replaceState(_state: ApprovalState): void {
    // Approvals are store-backed; snapshot hydration is intentionally not supported here.
  }

  has(id: string): boolean {
    return this.#pending.has(id);
  }

  get(id: string): ApprovalTask<unknown> | undefined {
    return this.#tasks.get(id);
  }

  async requestApproval<TInput>(
    task: ApprovalTask<TInput>,
    requestContext?: RequestContextRecord | null,
  ): Promise<unknown> {
    if (!requestContext) {
      throw new Error("Approval requestContext is required for store-backed approvals");
    }

    const activeTask = cloneTask(task);
    const expiresAt = this.#now() + this.#ttlMs;

    await this.#service.create({
      id: activeTask.id,
      type: activeTask.type,
      origin: activeTask.origin,
      ...(activeTask.namespace !== undefined ? { namespace: activeTask.namespace } : {}),
      ...(activeTask.chainRef !== undefined ? { chainRef: activeTask.chainRef } : {}),
      payload: activeTask.payload,
      requestContext,
      expiresAt,
      createdAt: activeTask.createdAt,
    });

    // Update cache eagerly so UI snapshot (sync) can resolve task payload without awaiting store sync.
    this.#tasks.set(activeTask.id, activeTask);
    this.#enqueue(activeTask);
    this.#publishRequest(activeTask);

    return new Promise((resolve, reject) => {
      this.#pending.set(activeTask.id, {
        task: activeTask,
        resolve,
        reject,
      });
    });
  }

  async resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult> {
    const entry = this.#pending.get(id);
    if (!entry) {
      // Missing resolver means the session is no longer recoverable; expire to avoid stuck UI items.
      await this.#service.finalize({ id, status: "expired", finalStatusReason: "session_lost" });
      await this.#queueSyncFromStore();
      throw new Error(`Approval ${id} not found`);
    }

    try {
      const value = await executor();
      this.#pending.delete(id);
      await this.#service.finalize({ id, status: "approved", result: value, finalStatusReason: "user_approve" });
      await this.#queueSyncFromStore();

      this.#publishFinish({
        id,
        namespace: entry.task.namespace,
        chainRef: entry.task.chainRef,
        value,
      });

      entry.resolve(value);
      return value;
    } catch (error) {
      this.#pending.delete(id);
      await this.#service.finalize({ id, status: "rejected", finalStatusReason: "internal_error" });
      await this.#queueSyncFromStore();

      const err = error instanceof Error ? error : new Error(String(error));
      entry.reject(err);
      throw err;
    }
  }

  reject(id: string, reason?: Error): void {
    const error = reason ?? new Error(this.#autoRejectMessage);

    void (async () => {
      try {
        await this.#service.finalize({ id, status: "rejected", finalStatusReason: "user_reject" });
        await this.#queueSyncFromStore();
      } catch (finalizeError) {
        // Avoid unhandled promise rejections on best-effort background persistence.
        console.warn("[StoreApprovalController] failed to reject approval", {
          id,
          error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
        });
      }
    })();

    const entry = this.#pending.get(id);
    if (!entry) return;
    this.#pending.delete(id);
    entry.reject(error);
  }

  async expirePendingByRequestContext(params: {
    portId: string;
    sessionId: string;
    finalStatusReason?: FinalStatusReason;
  }): Promise<number> {
    const pending = await this.#service.listPending();
    if (pending.length === 0) return 0;

    const matches = pending.filter(
      (record) =>
        record.requestContext.transport === "provider" &&
        record.requestContext.portId === params.portId &&
        record.requestContext.sessionId === params.sessionId,
    );

    if (matches.length === 0) return 0;

    const reason = params.finalStatusReason ?? "session_lost";

    for (const record of matches) {
      await this.#service.finalize({ id: record.id, status: "expired", finalStatusReason: reason });

      // Best-effort reject if there's an active resolver.
      const entry = this.#pending.get(record.id);
      if (entry) {
        this.#pending.delete(record.id);
        entry.reject(new Error("Approval expired due to session loss"));
      }
    }

    await this.#queueSyncFromStore();
    return matches.length;
  }

  async #queueSyncFromStore(): Promise<void> {
    if (this.#syncPromise) {
      this.#syncQueued = true;
      await this.#syncPromise;
      return;
    }

    this.#syncPromise = (async () => {
      try {
        const pending = await this.#service.listPending();
        const nextTasks = new Map<string, ApprovalTask<unknown>>();
        const nextState: ApprovalState = {
          pending: pending.map((record) => {
            const task = toTask(record);
            nextTasks.set(task.id, task);
            return toQueueItem(record);
          }),
        };

        this.#tasks = nextTasks;
        if (!isSameState(this.#state, nextState)) {
          this.#state = cloneState(nextState);
          this.#publishState();
        }
      } finally {
        this.#syncPromise = null;
      }
    })();

    await this.#syncPromise;
    if (this.#syncQueued) {
      this.#syncQueued = false;
      await this.#queueSyncFromStore();
    }
  }

  #enqueue(task: ApprovalTask<unknown>) {
    if (this.#state.pending.some((item) => item.id === task.id)) {
      return;
    }

    this.#state = {
      pending: [
        ...this.#state.pending,
        {
          id: task.id,
          type: task.type,
          origin: task.origin,
          namespace: task.namespace,
          chainRef: task.chainRef,
          createdAt: task.createdAt,
        },
      ],
    };

    this.#publishState();
  }

  #publishState() {
    this.#messenger.publish(APPROVAL_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishRequest(task: ApprovalTask<unknown>) {
    this.#messenger.publish(APPROVAL_REQUEST_TOPIC, cloneTask(task), {
      compare: (prev, next) => prev?.id === next?.id && prev?.type === next?.type,
    });
  }

  #publishFinish(result: ApprovalResult<unknown>) {
    this.#messenger.publish(APPROVAL_FINISH_TOPIC, cloneResult(result), {
      compare: (prev, next) => Object.is(prev?.id, next?.id),
    });
  }
}
