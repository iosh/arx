import { ArxReasons, arxError } from "@arx/errors";
import type { FinalStatusReason, RequestContextRecord } from "../../db/records.js";
import type { ApprovalsService } from "../../services/approvals/types.js";
import { createCoalescedRunner } from "../../utils/coalescedRunner.js";
import type {
  ApprovalController,
  ApprovalExecutor,
  ApprovalFinishedEvent,
  ApprovalMessenger,
  ApprovalRequestedEvent,
  ApprovalState,
  ApprovalTask,
  PendingApproval,
} from "./types.js";
import {
  cloneFinishEvent,
  cloneRequestEvent,
  cloneState,
  cloneTask,
  createDeferred,
  isSameState,
  toQueueItem,
  toSimpleError,
  toTask,
} from "./utils.js";

const APPROVAL_STATE_TOPIC = "approval:stateChanged";
const APPROVAL_REQUEST_TOPIC = "approval:requested";
const APPROVAL_FINISH_TOPIC = "approval:finished";

type CreateStoreApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  service: ApprovalsService;
  now?: () => number;
  autoRejectMessage?: string;
  logger?: (message: string, error?: unknown) => void;
  ttlMs?: number;
};

type FinalizeParams = {
  id: string;
  status: "approved" | "rejected" | "expired";
  finalStatusReason: FinalStatusReason;
  result?: unknown;
};

export class StoreApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #service: ApprovalsService;
  #now: () => number;
  #autoRejectMessage: string;
  #ttlMs: number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: ApprovalState = { pending: [] };
  #tasks: Map<string, ApprovalTask<unknown>> = new Map();
  #pending: Map<string, PendingApproval<unknown>> = new Map();

  #syncFromStore: () => Promise<void>;

  constructor({
    messenger,
    service,
    now = Date.now,
    autoRejectMessage,
    ttlMs,
    logger,
  }: CreateStoreApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#service = service;
    this.#now = now;
    this.#autoRejectMessage = autoRejectMessage ?? "Approval rejected by stub";
    this.#ttlMs = ttlMs ?? 5 * 60_000;
    this.#logger = logger;

    this.#syncFromStore = createCoalescedRunner(async () => {
      try {
        await this.#syncFromStoreOnce();
      } catch (error) {
        this.#logger?.("approvals: failed to sync from store", error);
      }
    });

    this.#service.on("changed", () => {
      void this.#syncFromStore();
    });

    void this.#syncFromStore();
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_TOPIC, handler);
  }

  onRequest(handler: (event: ApprovalRequestedEvent) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_REQUEST_TOPIC, handler);
  }

  onFinish(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void {
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

  async requestApproval<TInput>(task: ApprovalTask<TInput>, requestContext: RequestContextRecord): Promise<unknown> {
    if (!requestContext) throw new Error("Approval requestContext is required");

    const activeTask = cloneTask(task);

    if (activeTask.origin !== requestContext.origin) {
      throw new Error("Approval origin mismatch between task and requestContext");
    }

    if (this.#pending.has(activeTask.id)) {
      throw new Error(`Duplicate approval id "${activeTask.id}"`);
    }

    const deferred = createDeferred<unknown>();
    this.#pending.set(activeTask.id, {
      task: activeTask,
      resolve: deferred.resolve,
      reject: deferred.reject,
    });

    try {
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

      this.#tasks.set(activeTask.id, activeTask);
      this.#enqueue(activeTask);
      this.#publishRequest({ task: activeTask, requestContext });

      return deferred.promise;
    } catch (error) {
      this.#pending.delete(activeTask.id);
      throw error;
    }
  }

  async resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult> {
    const entry = this.#pending.get(id);
    if (!entry) {
      const task = this.#finalizeLocal(id);
      this.#publishFinish({ id, status: "expired", finalStatusReason: "session_lost", ...this.#taskMeta(task) });

      void this.#persistFinalize({ id, status: "expired", finalStatusReason: "session_lost" });
      throw new Error(`Approval ${id} not found`);
    }

    try {
      const value = await executor();

      this.#pending.delete(id);
      this.#finalizeLocal(id);

      this.#publishFinish({
        id,
        status: "approved",
        finalStatusReason: "user_approve",
        ...this.#taskMeta(entry.task),
        value,
      });

      entry.resolve(value);

      void this.#persistFinalize({ id, status: "approved", finalStatusReason: "user_approve", result: value });

      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.#pending.delete(id);
      this.#finalizeLocal(id);

      this.#publishFinish({
        id,
        status: "rejected",
        finalStatusReason: "internal_error",
        ...this.#taskMeta(entry.task),
        error: toSimpleError(err),
      });

      entry.reject(err);

      void this.#persistFinalize({ id, status: "rejected", finalStatusReason: "internal_error" });

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
      this.#finalizeLocal(id);

      entry.reject(error);

      this.#publishFinish({
        id,
        status: "rejected",
        finalStatusReason: "user_reject",
        ...this.#taskMeta(entry.task),
        error: toSimpleError(error),
      });
    } else {
      // Still finalize in store best-effort (eg. stale UI interactions).
      const task = this.#finalizeLocal(id);
      this.#publishFinish({
        id,
        status: "rejected",
        finalStatusReason: "user_reject",
        ...this.#taskMeta(task),
        error: toSimpleError(error),
      });
    }

    void this.#persistFinalize({ id, status: "rejected", finalStatusReason: "user_reject" });
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
      const meta = {
        type: record.type,
        origin: record.origin,
        ...(record.namespace !== undefined ? { namespace: record.namespace } : {}),
        ...(record.chainRef !== undefined ? { chainRef: record.chainRef } : {}),
      };

      const task = this.#finalizeLocal(record.id);
      const error = this.#getExpirationError({
        id: record.id,
        finalStatusReason: reason,
        meta,
      });

      const entry = this.#pending.get(record.id);
      if (entry) {
        this.#pending.delete(record.id);
        entry.reject(error);
      }

      this.#publishFinish({
        id: record.id,
        status: "expired",
        finalStatusReason: reason,
        ...meta,
      });

      void this.#persistFinalize({ id: record.id, status: "expired", finalStatusReason: reason });
    }
    return matches.length;
  }

  async #syncFromStoreOnce(): Promise<void> {
    const pending = await this.#service.listPending();
    const nextTasks = new Map<string, ApprovalTask<unknown>>();
    const fromStore = pending.map((record) => {
      const task = toTask(record);
      nextTasks.set(task.id, task);
      return toQueueItem(record);
    });

    const merged = [...fromStore];
    const storeIds = new Set(merged.map((item) => item.id));

    // Preserve in-memory pending approvals that may not be visible in the store snapshot yet.
    for (const [id, entry] of this.#pending) {
      if (storeIds.has(id)) continue;
      merged.push({
        id,
        type: entry.task.type,
        origin: entry.task.origin,
        namespace: entry.task.namespace,
        chainRef: entry.task.chainRef,
        createdAt: entry.task.createdAt,
      });
      nextTasks.set(id, entry.task);
    }

    merged.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const nextState: ApprovalState = { pending: merged };

    this.#tasks = nextTasks;
    if (isSameState(this.#state, nextState)) return;
    this.#state = cloneState(nextState);
    this.#publishState();
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

  #dequeue(id: string) {
    if (!this.#state.pending.some((item) => item.id === id)) return;
    this.#state = { pending: this.#state.pending.filter((item) => item.id !== id) };
    this.#publishState();
  }

  #finalizeLocal(id: string): ApprovalTask<unknown> | undefined {
    this.#dequeue(id);
    const task = this.#tasks.get(id);
    this.#tasks.delete(id);
    return task;
  }

  #taskMeta(task?: ApprovalTask<unknown>) {
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
    this.#messenger.publish(APPROVAL_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #publishRequest(event: ApprovalRequestedEvent) {
    this.#messenger.publish(APPROVAL_REQUEST_TOPIC, cloneRequestEvent(event), {
      compare: (prev, next) => prev?.task.id === next?.task.id && prev?.task.type === next?.task.type,
    });
  }

  #publishFinish(event: ApprovalFinishedEvent<unknown>) {
    this.#messenger.publish(APPROVAL_FINISH_TOPIC, cloneFinishEvent(event), {
      compare: (prev, next) => Object.is(prev?.id, next?.id) && Object.is(prev?.status, next?.status),
    });
  }

  async #persistFinalize(params: FinalizeParams): Promise<void> {
    try {
      const record = await this.#service.finalize({
        id: params.id,
        status: params.status,
        ...(params.status === "approved" ? { result: params.result } : {}),
        finalStatusReason: params.finalStatusReason,
      });

      if (!record) {
        this.#logger?.(`approvals: finalize skipped (${params.id} not found)`);
      }
    } catch (error) {
      this.#logger?.(`approvals: failed to finalize ${params.id}`, error);
    }
  }

  #getRejectionError(params: { id: string; provided?: Error | undefined; message: string }): Error {
    // If the caller provided an error, preserve it (tests and upstream layers may rely on custom fields like `code`).
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
      type: string;
      origin: string;
      namespace?: string | undefined;
      chainRef?: string | undefined;
    };
  }): Error {
    const data = { id: params.id, finalStatusReason: params.finalStatusReason, ...params.meta };

    if (params.finalStatusReason === "session_lost") {
      return arxError({ reason: ArxReasons.TransportDisconnected, message: "Transport disconnected.", data });
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
