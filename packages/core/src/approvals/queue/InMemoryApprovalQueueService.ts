import { parseChainRef } from "../../chains/caip.js";
import { OWNER_CHANGED } from "../../events/ownerChanged.js";
import type { Messenger } from "../../messenger/index.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../rpc/errors.js";
import { TransportDisconnectedError } from "../../runtime/provider/errors.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import {
  ApprovalCancelledError,
  ApprovalRejectedError,
  ApprovalSupersededError,
  ApprovalTimeoutError,
  ApprovalUserDismissedError,
} from "../errors.js";
import { APPROVAL_CREATED, APPROVAL_FINISHED, APPROVAL_STATE_CHANGED } from "./topics.js";
import type {
  ApprovalCreatedEvent,
  ApprovalCreateParams,
  ApprovalFinishedEvent,
  ApprovalHandle,
  ApprovalKind,
  ApprovalQueueService,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalResolveInput,
  ApprovalResolveResult,
  ApprovalScope,
  ApprovalState,
  ApprovalTerminalReason,
} from "./types.js";
import { createDeferred, deriveApprovalFinalStatus, serializeApprovalFinishedError } from "./utils.js";

type CreateInMemoryApprovalQueueServiceOptions = {
  messenger: Messenger;
  autoRejectMessage?: string;
  ttlMs?: number;
  logger?: (message: string, error?: unknown) => void;
};

type PendingApprovalSettlement = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PendingApproval<K extends ApprovalKind = ApprovalKind> = {
  record: ApprovalRecord<K>;
  settlement: PendingApprovalSettlement;
};

const getApprovalRequestChainRef = (request: ApprovalCreateParams): ApprovalCreateParams["chainRef"] => {
  if ("definition" in request.request) {
    return request.request.definition.chainRef;
  }

  return request.request.chainRef;
};

const assertApprovalContext = (request: ApprovalCreateParams) => {
  const recordChain = parseChainRef(request.chainRef);
  if (recordChain.namespace !== request.namespace) {
    throw new RpcInvalidParamsError({
      message: "Approval record namespace must match its chainRef.",
      details: {
        approvalId: request.approvalId,
        kind: request.kind,
        namespace: request.namespace,
        chainRef: request.chainRef,
      },
    });
  }

  const requestChainRef = getApprovalRequestChainRef(request);
  if (requestChainRef !== request.chainRef) {
    throw new RpcInvalidParamsError({
      message: "Approval request chainRef must match the approval record chainRef.",
      details: {
        approvalId: request.approvalId,
        kind: request.kind,
        recordChainRef: request.chainRef,
        requestChainRef,
      },
    });
  }

  const requestChain = parseChainRef(requestChainRef);
  if (requestChain.namespace !== request.namespace) {
    throw new RpcInvalidParamsError({
      message: "Approval request namespace must match the approval record namespace.",
      details: {
        approvalId: request.approvalId,
        kind: request.kind,
        namespace: request.namespace,
        chainRef: requestChainRef,
      },
    });
  }

  if ("requestedGrants" in request.request) {
    if (request.request.requestedGrants.length === 0) {
      throw new RpcInvalidParamsError({
        message: "Request-permissions approval must include at least one requested grant.",
        details: {
          approvalId: request.approvalId,
          kind: request.kind,
          chainRef: request.chainRef,
          namespace: request.namespace,
        },
      });
    }

    for (const descriptor of request.request.requestedGrants) {
      if (descriptor.chainRefs.length === 0) {
        throw new RpcInvalidParamsError({
          message: "Request-permissions approval descriptors must include explicit chainRefs.",
          details: {
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
          throw new RpcInvalidParamsError({
            message: "Request-permissions approval chainRefs must match the approval record namespace.",
            details: {
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

  if ("definition" in request.request) {
    const definitionNamespace = parseChainRef(request.request.definition.chainRef).namespace;
    if (definitionNamespace !== request.namespace) {
      throw new RpcInvalidParamsError({
        message: "Add-chain approval definition namespace must match the approval record namespace.",
        details: {
          approvalId: request.approvalId,
          kind: request.kind,
          namespace: request.namespace,
          definitionNamespace,
        },
      });
    }
  }
};

const isSameApprovalScope = (left: ApprovalScope, right: ApprovalScope): boolean => {
  if (left.transport !== right.transport || left.origin !== right.origin) {
    return false;
  }

  if (left.transport === "provider" && right.transport === "provider") {
    return left.portId === right.portId && left.sessionId === right.sessionId;
  }

  return left.transport === "wallet-ui" && right.transport === "wallet-ui";
};

export class InMemoryApprovalQueueService implements ApprovalQueueService {
  #messenger: Messenger;
  #autoRejectMessage: string;
  #ttlMs: number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: ApprovalState = { pending: [] };
  #records: Map<string, ApprovalRecord> = new Map();
  #pending: Map<string, PendingApproval> = new Map();
  #timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor({ messenger, autoRejectMessage, ttlMs, logger }: CreateInMemoryApprovalQueueServiceOptions) {
    this.#messenger = messenger;
    this.#autoRejectMessage = autoRejectMessage ?? "User rejected the request.";
    this.#ttlMs = ttlMs ?? 5 * 60_000;
    this.#logger = logger;
  }

  getState(): ApprovalState {
    return structuredClone(this.#state);
  }

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_CHANGED, handler);
  }

  onCreated(handler: (event: ApprovalCreatedEvent) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_CREATED, handler);
  }

  onFinished(handler: (event: ApprovalFinishedEvent) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_FINISHED, handler);
  }

  has(approvalId: string): boolean {
    return this.#pending.has(approvalId);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    const record = this.#records.get(approvalId);
    return record ? structuredClone(record) : undefined;
  }

  listPending(): ApprovalRecord[] {
    return this.#state.pending.flatMap((item) => {
      const record = this.#records.get(item.approvalId);
      return record ? [structuredClone(record)] : [];
    });
  }

  create<K extends ApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): ApprovalHandle {
    const deferred = createDeferred<unknown>();
    const record = this.#enqueuePendingApproval(request, requester, {
      resolve: deferred.resolve,
      reject: deferred.reject,
    });
    return { approvalId: record.approvalId, settled: deferred.promise };
  }

  #enqueuePendingApproval<K extends ApprovalKind>(
    request: ApprovalCreateParams<K>,
    requester: ApprovalRequester,
    settlement: PendingApprovalSettlement,
  ): ApprovalRecord<K> {
    if (!requester) throw new Error("Approval requester is required");
    assertApprovalContext(request);

    const record = structuredClone({ ...request, requester });

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

      this.#rejectPendingApproval(entry, error);

      this.#publishFinished({
        approvalId: input.approvalId,
        status: "rejected",
        terminalReason: "user_reject",
        ...this.#recordMeta(entry.record),
        error: serializeApprovalFinishedError(error),
      });

      return { approvalId: input.approvalId, status: "rejected", terminalReason: "user_reject" };
    }

    const decision = input.decision;

    this.#resolvePendingApproval(entry, decision);

    this.#publishFinished({
      approvalId: input.approvalId,
      status: "approved",
      terminalReason: "user_approve",
      ...this.#recordMeta(entry.record),
    });

    return { approvalId: input.approvalId, status: "approved", terminalReason: "user_approve", decision };
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

    this.#rejectPendingApproval(entry, error);

    this.#publishFinished({
      approvalId: input.approvalId,
      status: deriveApprovalFinalStatus(input.reason),
      terminalReason: input.reason,
      ...this.#recordMeta(entry.record),
      error: serializeApprovalFinishedError(error),
    });
  }

  async cancelScope(scope: ApprovalScope, reason: ApprovalTerminalReason): Promise<number> {
    const approvalIds = [...this.#pending.values()]
      .filter((entry) => isSameApprovalScope(entry.record.scope, scope))
      .map((entry) => entry.record.approvalId);

    for (const approvalId of approvalIds) {
      await this.cancel({ approvalId, reason });
    }

    return approvalIds.length;
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
        source: record.requester.source,
        scope: record.scope,
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
    entry.settlement.resolve(value);
  }

  #rejectPendingApproval(entry: PendingApproval, error: Error): void {
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
    this.#messenger.publish(APPROVAL_STATE_CHANGED, structuredClone(this.#state));
  }

  #publishCreated(event: ApprovalCreatedEvent) {
    this.#messenger.publish(APPROVAL_CREATED, structuredClone(event));
    this.#messenger.publish(OWNER_CHANGED, {
      topic: "approvals",
      change: "queue",
      approvalId: event.record.approvalId,
    });
  }

  #publishFinished(event: ApprovalFinishedEvent) {
    this.#messenger.publish(APPROVAL_FINISHED, structuredClone(event));
    this.#messenger.publish(OWNER_CHANGED, {
      topic: "approvals",
      change: "queue",
      approvalId: event.approvalId,
    });
  }

  #getRejectionError(params: { approvalId: string; provided?: Error | undefined; message: string }): Error {
    if (params.provided) return params.provided;

    return new ApprovalRejectedError({ message: params.message });
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
    if (params.terminalReason === "caller_disconnected") {
      return new TransportDisconnectedError();
    }
    if (params.terminalReason === "timeout") {
      return new ApprovalTimeoutError();
    }
    if (params.terminalReason === "locked") {
      return new SessionLockedError();
    }
    if (params.terminalReason === "internal_error") {
      return new RpcInternalError();
    }
    if (params.terminalReason === "user_dismissed") {
      return new ApprovalUserDismissedError();
    }
    if (params.terminalReason === "superseded") {
      return new ApprovalSupersededError();
    }
    if (params.terminalReason === "runtime_shutdown") {
      return new RpcInternalError();
    }
    if (params.terminalReason === "user_approve") {
      throw new Error(`Unexpected approval cancellation for approved request "${params.approvalId}"`);
    }

    return new ApprovalCancelledError();
  }
}
