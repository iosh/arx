import { ArxReasons, arxError } from "@arx/errors";
import type { RequestContext } from "../../rpc/requestContext.js";
import { APPROVAL_FINISHED, APPROVAL_REQUESTED, APPROVAL_STATE_CHANGED, type ApprovalMessenger } from "./topics.js";
import type {
  ApprovalController,
  ApprovalExecutor,
  ApprovalFinishedEvent,
  ApprovalRequestedEvent,
  ApprovalResultByType,
  ApprovalState,
  ApprovalTask,
  ApprovalType,
  FinalStatusReason,
  PendingApproval,
} from "./types.js";
import { cloneFinishEvent, cloneRequestEvent, cloneState, cloneTask, createDeferred, toSimpleError } from "./utils.js";

type CreateInMemoryApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  autoRejectMessage?: string;
  ttlMs?: number;
  logger?: (message: string, error?: unknown) => void;
};

export class InMemoryApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #autoRejectMessage: string;
  #ttlMs: number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: ApprovalState = { pending: [] };
  #tasks: Map<string, ApprovalTask> = new Map();
  #pending: Map<string, PendingApproval> = new Map();
  #timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor({ messenger, autoRejectMessage, ttlMs, logger }: CreateInMemoryApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#autoRejectMessage = autoRejectMessage ?? "User rejected the request.";
    this.#ttlMs = ttlMs ?? 5 * 60_000;
    this.#logger = logger;
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onRequest(handler: (event: ApprovalRequestedEvent) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_REQUESTED, handler);
  }

  onFinish(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_FINISHED, handler);
  }

  has(id: string): boolean {
    return this.#pending.has(id);
  }

  get(id: string): ApprovalTask | undefined {
    return this.#tasks.get(id);
  }

  async requestApproval<K extends ApprovalType>(
    task: ApprovalTask<K>,
    requestContext: RequestContext,
  ): Promise<ApprovalResultByType[K]> {
    if (!requestContext) throw new Error("Approval requestContext is required");

    const activeTask = cloneTask(task);

    if (activeTask.origin !== requestContext.origin) {
      throw new Error("Approval origin mismatch between task and requestContext");
    }

    if (this.#pending.has(activeTask.id)) {
      throw new Error(`Duplicate approval id "${activeTask.id}"`);
    }

    const deferred = createDeferred<ApprovalResultByType[K]>();
    this.#pending.set(activeTask.id, {
      task: activeTask,
      requestContext: { ...requestContext },
      resolve: deferred.resolve as (value: unknown) => void,
      reject: deferred.reject,
    });

    // TTL to avoid hanging approvals when the user never responds.
    this.#timeouts.set(
      activeTask.id,
      setTimeout(() => {
        this.#expireById(activeTask.id, "timeout");
      }, this.#ttlMs),
    );

    this.#tasks.set(activeTask.id, activeTask);
    this.#enqueue(activeTask);
    this.#publishRequest({ task: activeTask, requestContext });

    return deferred.promise;
  }

  async resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult> {
    const entry = this.#pending.get(id);
    if (!entry) {
      this.#clearTimeout(id);
      const task = this.#finalizeLocal(id);
      this.#publishFinish({ id, status: "expired", finalStatusReason: "session_lost", ...this.#taskMeta(task) });
      throw new Error(`Approval ${id} not found`);
    }

    try {
      const value = await executor();

      this.#pending.delete(id);
      this.#clearTimeout(id);
      this.#finalizeLocal(id);

      this.#publishFinish({
        id,
        status: "approved",
        finalStatusReason: "user_approve",
        ...this.#taskMeta(entry.task),
        value,
      });

      entry.resolve(value);
      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.#pending.delete(id);
      this.#clearTimeout(id);
      this.#finalizeLocal(id);

      this.#publishFinish({
        id,
        status: "rejected",
        finalStatusReason: "internal_error",
        ...this.#taskMeta(entry.task),
        error: toSimpleError(err),
      });

      entry.reject(err);
      throw err;
    }
  }

  reject(id: string, reason?: Error): void {
    const error = this.#getRejectionError({
      id,
      provided: reason,
      message: reason?.message ?? this.#autoRejectMessage,
    });

    const entry = this.#pending.get(id);
    if (entry) {
      this.#pending.delete(id);
      this.#clearTimeout(id);
      this.#finalizeLocal(id);
      entry.reject(error);

      this.#publishFinish({
        id,
        status: "rejected",
        finalStatusReason: "user_reject",
        ...this.#taskMeta(entry.task),
        error: toSimpleError(error),
      });
      return;
    }

    const task = this.#finalizeLocal(id);
    this.#clearTimeout(id);
    this.#publishFinish({
      id,
      status: "rejected",
      finalStatusReason: "user_reject",
      ...this.#taskMeta(task),
      error: toSimpleError(error),
    });
  }

  async expirePendingByRequestContext(params: {
    portId: string;
    sessionId: string;
    finalStatusReason?: FinalStatusReason;
  }): Promise<number> {
    const reason = params.finalStatusReason ?? "session_lost";
    const expiredIds: string[] = [];

    for (const [id, entry] of this.#pending) {
      const ctx = entry.requestContext;
      if (ctx.transport !== "provider") continue;
      if (ctx.portId !== params.portId) continue;
      if (ctx.sessionId !== params.sessionId) continue;
      expiredIds.push(id);
    }

    for (const id of expiredIds) {
      this.#expireById(id, reason);
    }

    return expiredIds.length;
  }

  #enqueue(task: ApprovalTask) {
    if (this.#state.pending.some((item) => item.id === task.id)) {
      return;
    }

    const next = [
      ...this.#state.pending,
      {
        id: task.id,
        type: task.type,
        origin: task.origin,
        namespace: task.namespace,
        chainRef: task.chainRef,
        createdAt: task.createdAt,
      },
    ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

    this.#state = { pending: next };
    this.#publishState();
  }

  #dequeue(id: string) {
    if (!this.#state.pending.some((item) => item.id === id)) return;
    this.#state = { pending: this.#state.pending.filter((item) => item.id !== id) };
    this.#publishState();
  }

  #finalizeLocal(id: string): ApprovalTask | undefined {
    this.#dequeue(id);
    const task = this.#tasks.get(id);
    this.#tasks.delete(id);
    return task;
  }

  #clearTimeout(id: string) {
    const timeout = this.#timeouts.get(id);
    if (!timeout) return;
    clearTimeout(timeout);
    this.#timeouts.delete(id);
  }

  #expireById(id: string, finalStatusReason: FinalStatusReason) {
    const entry = this.#pending.get(id);
    if (!entry) {
      this.#clearTimeout(id);
      return;
    }

    this.#pending.delete(id);
    this.#clearTimeout(id);
    this.#finalizeLocal(id);

    const meta = this.#taskMeta(entry.task);
    const error = this.#getExpirationError({ id, finalStatusReason, meta });

    try {
      entry.reject(error);
    } catch (rejectError) {
      this.#logger?.("approvals: failed to reject expired approval", rejectError);
    }

    this.#publishFinish({
      id,
      status: "expired",
      finalStatusReason,
      ...meta,
    });
  }

  #taskMeta(task?: ApprovalTask) {
    return task
      ? {
          type: task.type,
          origin: task.origin,
          namespace: task.namespace,
          chainRef: task.chainRef,
        }
      : {};
  }

  #publishState() {
    this.#messenger.publish(APPROVAL_STATE_CHANGED, cloneState(this.#state));
  }

  #publishRequest(event: ApprovalRequestedEvent) {
    this.#messenger.publish(APPROVAL_REQUESTED, cloneRequestEvent(event));
  }

  #publishFinish(event: ApprovalFinishedEvent<unknown>) {
    this.#messenger.publish(APPROVAL_FINISHED, cloneFinishEvent(event));
  }

  #getRejectionError(params: { id: string; provided?: Error | undefined; message: string }): Error {
    // Preserve caller-provided errors (they may carry extra fields like `code`).
    if (params.provided) return params.provided;

    return arxError({
      reason: ArxReasons.ApprovalRejected,
      message: params.message || "User rejected the request.",
      data: { id: params.id },
    });
  }

  #getExpirationError(params: {
    id: string;
    finalStatusReason: FinalStatusReason;
    meta: {
      type?: string | undefined;
      origin?: string | undefined;
      namespace?: string | undefined;
      chainRef?: string | undefined;
    };
  }): Error {
    const data = { id: params.id, finalStatusReason: params.finalStatusReason, ...params.meta };

    if (params.finalStatusReason === "session_lost") {
      return arxError({ reason: ArxReasons.TransportDisconnected, message: "Transport disconnected.", data });
    }
    if (params.finalStatusReason === "timeout") {
      return arxError({ reason: ArxReasons.ApprovalTimeout, message: "Request timed out.", data });
    }
    if (params.finalStatusReason === "locked") {
      return arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked.", data });
    }
    if (params.finalStatusReason === "internal_error") {
      return arxError({ reason: ArxReasons.RpcInternal, message: "Internal error.", data });
    }
    if (params.finalStatusReason === "user_approve") {
      return arxError({ reason: ArxReasons.RpcInternal, message: "Unexpected expiration reason.", data });
    }

    return arxError({ reason: ArxReasons.ApprovalRejected, message: "Request cancelled.", data });
  }
}
