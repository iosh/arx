import { ArxReasons, arxError } from "@arx/errors";
import type { ApprovalExecutor } from "../../approvals/types.js";
import { parseChainRef } from "../../chains/caip.js";
import { APPROVAL_CREATED, APPROVAL_FINISHED, APPROVAL_STATE_CHANGED, type ApprovalMessenger } from "./topics.js";
import type {
  ApprovalController,
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalKind,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalResultByKind,
  ApprovalState,
  ApprovalTerminalReason,
  PendingApproval,
} from "./types.js";
import {
  cloneCreatedEvent,
  cloneFinishEvent,
  cloneRecord,
  cloneState,
  createDeferred,
  deriveApprovalFinalStatus,
  matchesApprovalScope,
  toSimpleError,
} from "./utils.js";

type CreateInMemoryApprovalControllerOptions = {
  messenger: ApprovalMessenger;
  autoRejectMessage?: string;
  ttlMs?: number;
  logger?: (message: string, error?: unknown) => void;
  getExecutor?: () => ApprovalExecutor | undefined;
};

const getApprovalRequestChainRef = (request: ApprovalCreateParams): ApprovalCreateParams["chainRef"] => {
  if ("metadata" in request.request) {
    return request.request.metadata.chainRef;
  }

  return request.request.chainRef;
};

const assertApprovalContext = (request: ApprovalCreateParams) => {
  const recordChain = parseChainRef(request.chainRef);
  if (recordChain.namespace !== request.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval record namespace must match its chainRef.",
      data: { id: request.id, kind: request.kind, namespace: request.namespace, chainRef: request.chainRef },
    });
  }

  const requestChainRef = getApprovalRequestChainRef(request);
  if (requestChainRef !== request.chainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval request chainRef must match the approval record chainRef.",
      data: { id: request.id, kind: request.kind, recordChainRef: request.chainRef, requestChainRef },
    });
  }

  const requestChain = parseChainRef(requestChainRef);
  if (requestChain.namespace !== request.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval request namespace must match the approval record namespace.",
      data: { id: request.id, kind: request.kind, namespace: request.namespace, chainRef: requestChainRef },
    });
  }

  if ("requestedGrants" in request.request) {
    if (request.request.requestedGrants.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Request-permissions approval must include at least one requested grant.",
        data: { id: request.id, kind: request.kind, chainRef: request.chainRef, namespace: request.namespace },
      });
    }

    for (const descriptor of request.request.requestedGrants) {
      if (descriptor.chainRefs.length === 0) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Request-permissions approval descriptors must include explicit chainRefs.",
          data: {
            id: request.id,
            kind: request.kind,
            chainRef: request.chainRef,
            namespace: request.namespace,
            grantKind: descriptor.grantKind,
          },
        });
      }

      for (const targetChainRef of descriptor.chainRefs) {
        const targetChain = parseChainRef(targetChainRef);
        if (targetChain.namespace !== request.namespace) {
          throw arxError({
            reason: ArxReasons.RpcInvalidParams,
            message: "Request-permissions approval chainRefs must match the approval record namespace.",
            data: {
              id: request.id,
              kind: request.kind,
              namespace: request.namespace,
              chainRef: targetChainRef,
              grantKind: descriptor.grantKind,
            },
          });
        }
      }
    }
  }

  if ("metadata" in request.request && request.request.metadata.namespace !== request.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Add-chain approval metadata namespace must match the approval record namespace.",
      data: {
        id: request.id,
        kind: request.kind,
        namespace: request.namespace,
        metadataNamespace: request.request.metadata.namespace,
      },
    });
  }
};

export class InMemoryApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #autoRejectMessage: string;
  #ttlMs: number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;
  #getExecutor?: (() => ApprovalExecutor | undefined) | undefined;

  #state: ApprovalState = { pending: [] };
  #records: Map<string, ApprovalRecord> = new Map();
  #pending: Map<string, PendingApproval> = new Map();
  #timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor({ messenger, autoRejectMessage, ttlMs, logger, getExecutor }: CreateInMemoryApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#autoRejectMessage = autoRejectMessage ?? "User rejected the request.";
    this.#ttlMs = ttlMs ?? 5 * 60_000;
    this.#logger = logger;
    this.#getExecutor = getExecutor;
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  onCreated(handler: (event: ApprovalCreatedEvent) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_CREATED, handler);
  }

  onFinished(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_FINISHED, handler);
  }

  has(id: string): boolean {
    return this.#pending.has(id);
  }

  get(id: string): ApprovalRecord | undefined {
    const record = this.#records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle<K> {
    if (!requester) throw new Error("Approval requester is required");
    assertApprovalContext(request);

    const record = cloneRecord({ ...request, requester });

    if (record.origin !== requester.origin) {
      throw new Error("Approval origin mismatch between request and requester");
    }

    if (this.#pending.has(record.id)) {
      throw new Error(`Duplicate approval id "${record.id}"`);
    }

    const deferred = createDeferred<ApprovalResultByKind[K]>();
    this.#pending.set(record.id, {
      record,
      resolve: deferred.resolve as (value: unknown) => void,
      reject: deferred.reject,
    });

    this.#timeouts.set(
      record.id,
      setTimeout(() => {
        void this.cancel({ id: record.id, reason: "timeout" });
      }, this.#ttlMs),
    );

    this.#records.set(record.id, record);
    this.#enqueue(record);
    this.#publishCreated({ record });

    return { id: record.id, settled: deferred.promise };
  }

  async resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult> {
    const entry = this.#pending.get(input.id);
    if (!entry) {
      throw new Error(`Approval ${input.id} not found`);
    }

    if (input.action === "reject") {
      const error = this.#getRejectionError({
        id: input.id,
        provided: input.error,
        message: input.reason ?? input.error?.message ?? this.#autoRejectMessage,
      });

      const executor = this.#getExecutor?.();
      if (executor) {
        try {
          await executor.reject(entry.record, {
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
            error,
          });
        } catch (cleanupError) {
          this.#logger?.("approvals: reject cleanup failed", cleanupError);
        }
      }

      this.#pending.delete(input.id);
      this.#clearTimeout(input.id);
      this.#finalizeLocal(input.id);
      entry.reject(error);

      this.#publishFinished({
        id: input.id,
        status: "rejected",
        terminalReason: "user_reject",
        ...this.#recordMeta(entry.record),
        error: toSimpleError(error),
      });

      return { id: input.id, status: "rejected", terminalReason: "user_reject" };
    }

    try {
      const executor = this.#getExecutor?.();
      if (!executor) {
        throw new Error(`Approval executor not configured for ${input.id}`);
      }

      const value = await executor.approve(entry.record, input.decision);

      this.#pending.delete(input.id);
      this.#clearTimeout(input.id);
      this.#finalizeLocal(input.id);

      this.#publishFinished({
        id: input.id,
        status: "approved",
        terminalReason: "user_approve",
        ...this.#recordMeta(entry.record),
        value,
      });

      entry.resolve(value);
      return { id: input.id, status: "approved", terminalReason: "user_approve", value };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.#pending.delete(input.id);
      this.#clearTimeout(input.id);
      this.#finalizeLocal(input.id);

      this.#publishFinished({
        id: input.id,
        status: "failed",
        terminalReason: "internal_error",
        ...this.#recordMeta(entry.record),
        error: toSimpleError(err),
      });

      entry.reject(err);
      throw err;
    }
  }

  async cancel(input: { id: string; reason: ApprovalTerminalReason; error?: Error }): Promise<void> {
    const entry = this.#pending.get(input.id);
    if (!entry) {
      this.#clearTimeout(input.id);
      this.#finalizeLocal(input.id);
      return;
    }

    const error =
      input.error ??
      this.#getTerminalError({
        id: input.id,
        terminalReason: input.reason,
        meta: this.#recordMeta(entry.record),
      });

    const executor = this.#getExecutor?.();
    if (executor) {
      try {
        await executor.cancel(entry.record, input.reason, error);
      } catch (cleanupError) {
        this.#logger?.("approvals: cancel cleanup failed", cleanupError);
      }
    }

    this.#pending.delete(input.id);
    this.#clearTimeout(input.id);
    this.#finalizeLocal(input.id);

    try {
      entry.reject(error);
    } catch (rejectError) {
      this.#logger?.("approvals: failed to reject cancelled approval", rejectError);
    }

    this.#publishFinished({
      id: input.id,
      status: deriveApprovalFinalStatus(input.reason),
      terminalReason: input.reason,
      ...this.#recordMeta(entry.record),
      error: toSimpleError(error),
    });
  }

  async cancelByScope(input: {
    scope:
      | ApprovalRequester
      | { transport: ApprovalRequester["transport"]; origin: string; portId: string; sessionId: string };
    reason: ApprovalTerminalReason;
  }): Promise<number> {
    const cancelledIds: string[] = [];

    for (const [id, entry] of this.#pending) {
      if (matchesApprovalScope(entry.record.requester, input.scope)) {
        cancelledIds.push(id);
      }
    }

    await Promise.all(
      cancelledIds.map((id) =>
        this.cancel({
          id,
          reason: input.reason,
        }),
      ),
    );

    return cancelledIds.length;
  }

  #enqueue(record: ApprovalRecord) {
    if (this.#state.pending.some((item) => item.id === record.id)) {
      return;
    }

    const next = [
      ...this.#state.pending,
      {
        id: record.id,
        kind: record.kind,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
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

  #finalizeLocal(id: string): ApprovalRecord | undefined {
    this.#dequeue(id);
    const record = this.#records.get(id);
    this.#records.delete(id);
    return record;
  }

  #clearTimeout(id: string) {
    const timeout = this.#timeouts.get(id);
    if (!timeout) return;
    clearTimeout(timeout);
    this.#timeouts.delete(id);
  }

  #recordMeta(record?: ApprovalRecord) {
    return record
      ? {
          kind: record.kind,
          origin: record.origin,
          namespace: record.namespace,
          chainRef: record.chainRef,
        }
      : {};
  }

  #publishState() {
    this.#messenger.publish(APPROVAL_STATE_CHANGED, cloneState(this.#state));
  }

  #publishCreated(event: ApprovalCreatedEvent) {
    this.#messenger.publish(APPROVAL_CREATED, cloneCreatedEvent(event));
  }

  #publishFinished(event: ApprovalFinishedEvent<unknown>) {
    this.#messenger.publish(APPROVAL_FINISHED, cloneFinishEvent(event));
  }

  #getRejectionError(params: { id: string; provided?: Error | undefined; message: string }): Error {
    if (params.provided) return params.provided;

    return arxError({
      reason: ArxReasons.ApprovalRejected,
      message: params.message || "User rejected the request.",
      data: { id: params.id },
    });
  }

  #getTerminalError(params: {
    id: string;
    terminalReason: ApprovalTerminalReason;
    meta: {
      kind?: string | undefined;
      origin?: string | undefined;
      namespace?: string | undefined;
      chainRef?: string | undefined;
    };
  }): Error {
    const data = { id: params.id, terminalReason: params.terminalReason, ...params.meta };

    if (params.terminalReason === "session_lost") {
      return arxError({ reason: ArxReasons.TransportDisconnected, message: "Transport disconnected.", data });
    }
    if (params.terminalReason === "timeout") {
      return arxError({ reason: ArxReasons.ApprovalTimeout, message: "Request timed out.", data });
    }
    if (params.terminalReason === "locked") {
      return arxError({ reason: ArxReasons.SessionLocked, message: "Wallet is locked.", data });
    }
    if (params.terminalReason === "internal_error") {
      return arxError({ reason: ArxReasons.RpcInternal, message: "Internal error.", data });
    }
    if (params.terminalReason === "window_closed") {
      return arxError({ reason: ArxReasons.ApprovalRejected, message: "Approval window closed.", data });
    }
    if (params.terminalReason === "replaced") {
      return arxError({ reason: ArxReasons.ApprovalRejected, message: "Request replaced.", data });
    }
    if (params.terminalReason === "user_approve") {
      return arxError({ reason: ArxReasons.RpcInternal, message: "Unexpected approval cancellation.", data });
    }

    return arxError({ reason: ArxReasons.ApprovalRejected, message: "Request cancelled.", data });
  }
}
