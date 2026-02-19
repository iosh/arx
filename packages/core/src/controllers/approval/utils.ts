import type {
  ApprovalFinishedEvent,
  ApprovalRequestedEvent,
  ApprovalState,
  ApprovalTask,
  ApprovalType,
} from "./types.js";

export const cloneState = (state: ApprovalState): ApprovalState => ({
  pending: state.pending.map((item) => ({
    id: item.id,
    type: item.type,
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
      current.type === other.type &&
      current.origin === other.origin &&
      current.namespace === other.namespace &&
      current.chainRef === other.chainRef &&
      current.createdAt === other.createdAt;

    if (!matches) return false;
  }

  return true;
};

export const cloneTask = <K extends ApprovalType>(task: ApprovalTask<K>): ApprovalTask<K> => ({
  id: task.id,
  type: task.type,
  origin: task.origin,
  namespace: task.namespace,
  chainRef: task.chainRef,
  payload: task.payload,
  createdAt: task.createdAt,
});

export const cloneRequestEvent = (event: ApprovalRequestedEvent): ApprovalRequestedEvent => ({
  task: cloneTask(event.task),
  requestContext: { ...event.requestContext },
});

export const cloneFinishEvent = <T>(event: ApprovalFinishedEvent<T>): ApprovalFinishedEvent<T> => ({
  id: event.id,
  status: event.status,
  finalStatusReason: event.finalStatusReason,
  ...(event.type !== undefined ? { type: event.type } : {}),
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
