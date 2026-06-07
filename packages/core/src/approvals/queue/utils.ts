import type {
  ApprovalCreatedEvent,
  ApprovalFinalStatus,
  ApprovalFinishedErrorSummary,
  ApprovalFinishedEvent,
  ApprovalQueueKind,
  ApprovalRecord,
  ApprovalState,
  ApprovalTerminalReason,
} from "./types.js";

export { createDeferred, type Deferred } from "../../utils/deferred.js";

export const cloneState = (state: ApprovalState): ApprovalState => ({
  pending: state.pending.map((item) => ({
    approvalId: item.approvalId,
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
      current.approvalId === other.approvalId &&
      current.kind === other.kind &&
      current.origin === other.origin &&
      current.namespace === other.namespace &&
      current.chainRef === other.chainRef &&
      current.createdAt === other.createdAt;

    if (!matches) return false;
  }

  return true;
};

export const cloneRecord = <K extends ApprovalQueueKind>(record: ApprovalRecord<K>): ApprovalRecord<K> => ({
  approvalId: record.approvalId,
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
  approvalId: event.approvalId,
  status: event.status,
  terminalReason: event.terminalReason,
  ...(event.kind !== undefined ? { kind: event.kind } : {}),
  ...(event.origin !== undefined ? { origin: event.origin } : {}),
  ...(event.namespace !== undefined ? { namespace: event.namespace } : {}),
  ...(event.chainRef !== undefined ? { chainRef: event.chainRef } : {}),
  ...(event.value !== undefined ? { value: event.value } : {}),
  ...(event.error ? { error: { ...event.error } } : {}),
});

export const serializeApprovalFinishedError = (error: unknown): ApprovalFinishedErrorSummary => {
  const err = error instanceof Error ? error : new Error(String(error));
  const code = "code" in err && typeof err.code === "string" ? err.code : undefined;
  return {
    name: err.name || "Error",
    message: err.message || "Unknown error",
    ...(code !== undefined ? { code } : {}),
  };
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
    case "caller_disconnected":
    case "user_dismissed":
    case "superseded":
    case "runtime_shutdown":
      return "cancelled";
  }
};
