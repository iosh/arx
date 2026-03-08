import type { RequestContext } from "../../rpc/requestContext.js";
import type {
  ApprovalCreatedEvent,
  ApprovalFinalStatus,
  ApprovalFinishedEvent,
  ApprovalKind,
  ApprovalRecord,
  ApprovalRequester,
  ApprovalScope,
  ApprovalState,
  ApprovalTerminalReason,
} from "./types.js";

export const cloneState = (state: ApprovalState): ApprovalState => ({
  pending: state.pending.map((item) => ({
    id: item.id,
    kind: item.kind,
    origin: item.origin,
    namespace: item.namespace,
    chainRef: item.chainRef,
    createdAt: item.createdAt,
  })),
});

export const isSameState = (prev?: ApprovalState, next?: ApprovalState) => {
  if (!prev || !next) return false;
  if (prev.pending.length !== next.pending.length) return false;

  for (let index = 0; index < prev.pending.length; index += 1) {
    const current = prev.pending[index];
    const other = next.pending[index];
    if (!other || !current) return false;

    const matches =
      current.id === other.id &&
      current.kind === other.kind &&
      current.origin === other.origin &&
      current.namespace === other.namespace &&
      current.chainRef === other.chainRef &&
      current.createdAt === other.createdAt;

    if (!matches) return false;
  }

  return true;
};

export const cloneRecord = <K extends ApprovalKind>(record: ApprovalRecord<K>): ApprovalRecord<K> => ({
  id: record.id,
  kind: record.kind,
  origin: record.origin,
  namespace: record.namespace,
  chainRef: record.chainRef,
  request: record.request,
  createdAt: record.createdAt,
  requester: { ...record.requester },
});

export const cloneCreatedEvent = (event: ApprovalCreatedEvent): ApprovalCreatedEvent => ({
  record: cloneRecord(event.record),
});

export const cloneFinishEvent = <T>(event: ApprovalFinishedEvent<T>): ApprovalFinishedEvent<T> => ({
  id: event.id,
  status: event.status,
  terminalReason: event.terminalReason,
  ...(event.kind !== undefined ? { kind: event.kind } : {}),
  ...(event.origin !== undefined ? { origin: event.origin } : {}),
  ...(event.namespace !== undefined ? { namespace: event.namespace } : {}),
  ...(event.chainRef !== undefined ? { chainRef: event.chainRef } : {}),
  ...(event.value !== undefined ? { value: event.value } : {}),
  ...(event.error ? { error: { ...event.error } } : {}),
});

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

export const toSimpleError = (error: unknown): { name: string; message: string } => {
  const err = error instanceof Error ? error : new Error(String(error));
  return { name: err.name || "Error", message: err.message || "Unknown error" };
};

export const toApprovalRequester = (requestContext: RequestContext): ApprovalRequester => ({
  transport: requestContext.transport,
  origin: requestContext.origin,
  portId: requestContext.portId,
  sessionId: requestContext.sessionId,
  requestId: requestContext.requestId,
});

export const matchesApprovalScope = (requester: ApprovalRequester, scope: ApprovalScope) => {
  return (
    requester.transport === scope.transport &&
    requester.origin === scope.origin &&
    requester.portId === scope.portId &&
    requester.sessionId === scope.sessionId
  );
};

export const deriveApprovalFinalStatus = (terminalReason: ApprovalTerminalReason): ApprovalFinalStatus => {
  switch (terminalReason) {
    case "user_approve":
      return "approved";
    case "user_reject":
      return "rejected";
    case "timeout":
      return "expired";
    case "internal_error":
      return "failed";
    case "locked":
    case "session_lost":
    case "window_closed":
    case "replaced":
      return "cancelled";
  }
};
