import type {
  ApprovalController,
  ApprovalControllerOptions,
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

export class InMemoryApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #state: ApprovalState;
  #autoRejectMessage: string;
  #pending: Map<string, PendingApproval<unknown>>;

  constructor({ messenger, autoRejectMessage, initialState }: ApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#state = cloneState(initialState ?? { pending: [] });
    this.#pending = new Map();
    this.#autoRejectMessage = autoRejectMessage ?? "Approval rejected by stub";

    this.#publishState();
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  async requestApproval<TInput>(task: ApprovalTask<TInput>): Promise<unknown> {
    const activeTask = cloneTask(task);
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

  onStateChanged(handler: (state: ApprovalState) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_STATE_TOPIC, handler);
  }

  onRequest(handler: (task: ApprovalTask<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_REQUEST_TOPIC, handler);
  }

  onFinish(handler: (result: ApprovalResult<unknown>) => void): () => void {
    return this.#messenger.subscribe(APPROVAL_FINISH_TOPIC, handler);
  }

  replaceState(state: ApprovalState): void {
    this.#state = cloneState(state);
    this.#publishState();
  }

  has(id: string): boolean {
    return this.#pending.has(id);
  }

  get(id: string): ApprovalTask<unknown> | undefined {
    return this.#pending.get(id)?.task;
  }

  async resolve<TResult>(id: string, executor: ApprovalExecutor<TResult>): Promise<TResult> {
    const entry = this.#pending.get(id);
    if (!entry) {
      throw new Error(`Approval ${id} not found`);
    }

    try {
      const value = await executor();
      this.#pending.delete(id);
      this.#finalize(id);
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
      this.#finalize(id);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  reject(id: string, reason?: Error): void {
    const entry = this.#pending.get(id);
    if (!entry) return;

    const error = reason ?? new Error(this.#autoRejectMessage);
    this.#pending.delete(id);
    this.#finalize(id);
    entry.reject(error);
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

  #finalize(id: string) {
    if (!this.#state.pending.some((item) => item.id === id)) {
      return;
    }
    this.#state = {
      pending: this.#state.pending.filter((item) => item.id !== id),
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
