import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../../chains/caip.js";
import type { ApprovalExecutor } from "../types.js";
import { APPROVAL_CREATED, APPROVAL_FINISHED, APPROVAL_STATE_CHANGED, type ApprovalMessenger } from "./topics.js";
import type {
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalQueueKind,
  ApprovalQueueService,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalResultByKind,
  ApprovalState,
  ApprovalTerminalReason,
  PendingApproval,
  PendingApprovalSettlement,
} from "./types.js";
import {
  cloneCreatedEvent,
  cloneFinishEvent,
  cloneRecord,
  cloneState,
  createDeferred,
  deriveApprovalFinalStatus,
  toSimpleError,
} from "./utils.js";

type CreateInMemoryApprovalQueueServiceOptions = {
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
      data: {
        approvalId: request.approvalId,
        kind: request.kind,
        namespace: request.namespace,
        chainRef: request.chainRef,
      },
    });
  }

  const requestChainRef = getApprovalRequestChainRef(request);
  if (requestChainRef !== request.chainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval request chainRef must match the approval record chainRef.",
      data: {
        approvalId: request.approvalId,
        kind: request.kind,
        recordChainRef: request.chainRef,
        requestChainRef,
      },
    });
  }

  const requestChain = parseChainRef(requestChainRef);
  if (requestChain.namespace !== request.namespace) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "Approval request namespace must match the approval record namespace.",
      data: {
        approvalId: request.approvalId,
        kind: request.kind,
        namespace: request.namespace,
        chainRef: requestChainRef,
      },
    });
  }

  if ("requestedGrants" in request.request) {
    if (request.request.requestedGrants.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Request-permissions approval must include at least one requested grant.",
        data: {
          approvalId: request.approvalId,
          kind: request.kind,
          chainRef: request.chainRef,
          namespace: request.namespace,
        },
      });
    }

    for (const descriptor of request.request.requestedGrants) {
      if (descriptor.chainRefs.length === 0) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "Request-permissions approval descriptors must include explicit chainRefs.",
          data: {
            approvalId: request.approvalId,
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
              approvalId: request.approvalId,
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
        approvalId: request.approvalId,
        kind: request.kind,
        namespace: request.namespace,
        metadataNamespace: request.request.metadata.namespace,
      },
    });
  }
};

export class InMemoryApprovalQueueService implements ApprovalQueueService {
  #messenger: ApprovalMessenger;
  #autoRejectMessage: string;
  #ttlMs: number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;
  #getExecutor?: (() => ApprovalExecutor | undefined) | undefined;

  #state: ApprovalState = { pending: [] };
  #records: Map<string, ApprovalRecord> = new Map();
  #pending: Map<string, PendingApproval> = new Map();
  #timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor({ messenger, autoRejectMessage, ttlMs, logger, getExecutor }: CreateInMemoryApprovalQueueServiceOptions) {
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

  has(approvalId: string): boolean {
    return this.#pending.has(approvalId);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    const record = this.#records.get(approvalId);
    return record ? cloneRecord(record) : undefined;
  }

  create<K extends ApprovalQueueKind>(
    request: ApprovalCreateParams<K>,
    requester: ApprovalRequester,
  ): ApprovalHandle<K> {
    const deferred = createDeferred<ApprovalResultByKind[K]>();
    const record = this.#enqueuePendingApproval(request, requester, {
      kind: "handle",
      resolve: deferred.resolve as (value: unknown) => void,
      reject: deferred.reject,
    });
    return { approvalId: record.approvalId, settled: deferred.promise };
  }

  createPending<K extends ApprovalQueueKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): void {
    this.#enqueuePendingApproval(request, requester, {
      kind: "internal",
    });
  }

  #enqueuePendingApproval<K extends ApprovalQueueKind>(
    request: ApprovalCreateParams<K>,
    requester: ApprovalRequester,
    settlement: PendingApprovalSettlement,
  ): ApprovalRecord<K> {
    if (!requester) throw new Error("Approval requester is required");
    assertApprovalContext(request);

    const record = cloneRecord({ ...request, requester });

    if (record.origin !== requester.origin) {
      throw new Error("Approval origin mismatch between request and requester");
    }

    if (this.#pending.has(record.approvalId)) {
      throw new Error(`Duplicate approval id "${record.approvalId}"`);
    }

    this.#pending.set(record.approvalId, {
      record,
      settlement,
    });

    this.#timeouts.set(
      record.approvalId,
      setTimeout(() => {
        void this.cancel({ approvalId: record.approvalId, reason: "timeout" });
      }, this.#ttlMs),
    );

    this.#records.set(record.approvalId, record);
    this.#enqueue(record);
    this.#publishCreated({ record });

    return record;
  }

  async resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult> {
    const entry = this.#takePendingApproval(input.approvalId);
    if (!entry) {
      throw new Error(`Approval ${input.approvalId} not found`);
    }

    if (input.action === "reject") {
      const error = this.#getRejectionError({
        approvalId: input.approvalId,
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

      this.#rejectPendingApproval(entry, error);

      this.#publishFinished({
        approvalId: input.approvalId,
        status: "rejected",
        terminalReason: "user_reject",
        ...this.#recordMeta(entry.record),
        error: toSimpleError(error),
      });

      return { approvalId: input.approvalId, status: "rejected", terminalReason: "user_reject" };
    }

    try {
      const executor = this.#getExecutor?.();
      if (!executor) {
        throw new Error(`Approval executor not configured for ${input.approvalId}`);
      }

      const value = await executor.approve(entry.record, input.decision);

      this.#publishFinished({
        approvalId: input.approvalId,
        status: "approved",
        terminalReason: "user_approve",
        ...this.#recordMeta(entry.record),
        value,
      });

      this.#resolvePendingApproval(entry, value);
      return { approvalId: input.approvalId, status: "approved", terminalReason: "user_approve", value };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.#publishFinished({
        approvalId: input.approvalId,
        status: "failed",
        terminalReason: "internal_error",
        ...this.#recordMeta(entry.record),
        error: toSimpleError(err),
      });

      this.#rejectPendingApproval(entry, err);
      throw err;
    }
  }

  async cancel(input: { approvalId: string; reason: ApprovalTerminalReason; error?: Error }): Promise<void> {
    const entry = this.#takePendingApproval(input.approvalId);
    if (!entry) {
      return;
    }

    const error =
      input.error ??
      this.#getTerminalError({
        approvalId: input.approvalId,
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

    this.#rejectPendingApproval(entry, error);

    this.#publishFinished({
      approvalId: input.approvalId,
      status: deriveApprovalFinalStatus(input.reason),
      terminalReason: input.reason,
      ...this.#recordMeta(entry.record),
      error: toSimpleError(error),
    });
  }

  #enqueue(record: ApprovalRecord) {
    if (this.#state.pending.some((item) => item.approvalId === record.approvalId)) {
      return;
    }

    const next = [
      ...this.#state.pending,
      {
        approvalId: record.approvalId,
        kind: record.kind,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
      },
    ].sort((a, b) => a.createdAt - b.createdAt || a.approvalId.localeCompare(b.approvalId));

    this.#state = { pending: next };
    this.#publishState();
  }

  #dequeue(approvalId: string) {
    if (!this.#state.pending.some((item) => item.approvalId === approvalId)) return;
    this.#state = { pending: this.#state.pending.filter((item) => item.approvalId !== approvalId) };
    this.#publishState();
  }

  #finalizeLocal(approvalId: string): ApprovalRecord | undefined {
    this.#dequeue(approvalId);
    const record = this.#records.get(approvalId);
    this.#records.delete(approvalId);
    return record;
  }

  #clearTimeout(approvalId: string) {
    const timeout = this.#timeouts.get(approvalId);
    if (!timeout) return;
    clearTimeout(timeout);
    this.#timeouts.delete(approvalId);
  }

  #takePendingApproval(approvalId: string): PendingApproval | null {
    const entry = this.#pending.get(approvalId);
    if (!entry) {
      return null;
    }

    this.#pending.delete(approvalId);
    this.#clearTimeout(approvalId);
    this.#finalizeLocal(approvalId);
    return entry;
  }

  #resolvePendingApproval(entry: PendingApproval, value: unknown): void {
    if (entry.settlement.kind !== "handle") {
      return;
    }

    entry.settlement.resolve(value);
  }

  #rejectPendingApproval(entry: PendingApproval, error: Error): void {
    if (entry.settlement.kind !== "handle") {
      return;
    }

    try {
      entry.settlement.reject(error);
    } catch (rejectError) {
      this.#logger?.("approvals: failed to reject approval handle", rejectError);
    }
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

  #getRejectionError(params: { approvalId: string; provided?: Error | undefined; message: string }): Error {
    if (params.provided) return params.provided;

    return arxError({
      reason: ArxReasons.ApprovalRejected,
      message: params.message || "User rejected the request.",
      data: { approvalId: params.approvalId },
    });
  }

  #getTerminalError(params: {
    approvalId: string;
    terminalReason: ApprovalTerminalReason;
    meta: {
      kind?: string | undefined;
      origin?: string | undefined;
      namespace?: string | undefined;
      chainRef?: string | undefined;
    };
  }): Error {
    const data = { approvalId: params.approvalId, terminalReason: params.terminalReason, ...params.meta };

    if (params.terminalReason === "caller_disconnected") {
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
    if (params.terminalReason === "user_dismissed") {
      return arxError({ reason: ArxReasons.ApprovalRejected, message: "Approval dismissed.", data });
    }
    if (params.terminalReason === "superseded") {
      return arxError({ reason: ArxReasons.ApprovalRejected, message: "Request superseded.", data });
    }
    if (params.terminalReason === "runtime_shutdown") {
      return arxError({ reason: ArxReasons.RpcInternal, message: "Runtime shut down.", data });
    }
    if (params.terminalReason === "user_approve") {
      throw new Error(`Unexpected approval cancellation for approved request: ${JSON.stringify(data)}`);
    }

    return arxError({ reason: ArxReasons.ApprovalRejected, message: "Request cancelled.", data });
  }
}
