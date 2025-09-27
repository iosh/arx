import type {
  ApprovalController,
  ApprovalControllerOptions,
  ApprovalMessenger,
  ApprovalResult,
  ApprovalState,
  ApprovalStrategy,
  ApprovalTask,
} from "./types.js";

const APPROVAL_STATE_TOPIC = "approval:stateChanged";
const APPROVAL_REQUEST_TOPIC = "approval:requested";
const APPROVAL_FINISH_TOPIC = "approval:finished";

const cloneState = (state: ApprovalState): ApprovalState => ({
  pending: [...state.pending],
});

const isSameState = (prev?: ApprovalState, next?: ApprovalState) => {
  if (!prev || !next) return false;

  if (prev.pending.length !== next.pending.length) return false;

  return prev.pending.every((id, index) => id === next.pending[index]);
};

const cloneTask = <T>(task: ApprovalTask<T>): ApprovalTask<T> => ({
  id: task.id,
  type: task.type,
  origin: task.origin,
  payload: task.payload,
});

const cloneResult = <T>(result: ApprovalResult<T>): ApprovalResult<T> => ({
  id: result.id,
  value: result.value,
});

export class InMemoryApprovalController implements ApprovalController {
  #messenger: ApprovalMessenger;
  #state: ApprovalState;
  #defaultStrategy: ApprovalStrategy<unknown, unknown>;
  #autoRejectMessage: string;

  constructor({ messenger, defaultStrategy, autoRejectMessage }: ApprovalControllerOptions) {
    this.#messenger = messenger;
    this.#state = { pending: [] };

    this.#autoRejectMessage = autoRejectMessage ?? "Approval rejected by stub";
    this.#defaultStrategy =
      defaultStrategy ??
      (async () => {
        const error = Object.assign(new Error(this.#autoRejectMessage), {
          name: "ApprovalRejectedError",
        });
        throw error;
      });

    this.#publishState();
  }

  getState(): ApprovalState {
    return cloneState(this.#state);
  }

  async requestApproval<TInput, TResult>(
    task: ApprovalTask<TInput>,
    strategy?: ApprovalStrategy<TInput, TResult>,
  ): Promise<TResult> {
    const activeTask = cloneTask(task);
    this.#enqueue(activeTask.id);
    this.#publishRequest(activeTask);

    const handler = strategy ?? (this.#defaultStrategy as ApprovalStrategy<TInput, TResult>);

    try {
      const value = await handler(activeTask);
      this.#finalize(activeTask.id);
      this.#publishFinish({ id: activeTask.id, value });
      return value;
    } catch (error) {
      this.#finalize(activeTask.id);
      throw error;
    }
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

  #enqueue(id: string) {
    if (this.#state.pending.includes(id)) {
      return;
    }

    this.#state = {
      pending: [...this.#state.pending, id],
    };

    this.#publishState();
  }

  #finalize(id: string) {
    if (!this.#state.pending.includes(id)) {
      return;
    }
    this.#state = {
      pending: this.#state.pending.filter((item) => item !== id),
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
