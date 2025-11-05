import type {
  ReceiptResolution,
  ReplacementResolution,
  TransactionAdapter,
  TransactionAdapterContext,
} from "../adapters/types.js";

type TrackerAdapter = Pick<TransactionAdapter, "fetchReceipt" | "detectReplacement">;

type TrackerDeps = {
  getAdapter(namespace: string): TrackerAdapter | undefined;
  onReceipt(id: string, resolution: ReceiptResolution): void | Promise<void>;
  onReplacement(id: string, resolution: ReplacementResolution): void | Promise<void>;
  onTimeout(id: string): void | Promise<void>;
  onError?(id: string, error: unknown): void | Promise<void>;
};
type TrackerOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
};

type TaskState = {
  id: string;
  context: TransactionAdapterContext;
  hash: string;
  attempts: number;
  delay: number;
  handle: ReturnType<typeof setTimeout> | null;
  active: boolean;
};

const DEFAULT_INITIAL_DELAY_MS = 3_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 20;

export type ReceiptTracker = {
  start(id: string, context: TransactionAdapterContext, hash: string): void;
  resume(id: string, context: TransactionAdapterContext, hash: string): void;
  stop(id: string): void;
  isTracking(id: string): boolean;
  pending(): number;
};

export const createReceiptTracker = (deps: TrackerDeps, options?: TrackerOptions): ReceiptTracker => {
  const tasks = new Map<string, TaskState>();
  const initialDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelay = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const stop = (id: string) => {
    const state = tasks.get(id);
    if (!state) return;
    if (state.handle !== null) {
      clearTimeout(state.handle);
      state.handle = null;
    }
    state.active = false;
    tasks.delete(id);
  };

  const schedule = (state: TaskState) => {
    if (!state.active) return;
    state.handle = setTimeout(() => {
      state.handle = null;
      void tick(state);
    }, state.delay);
  };

  const tick = async (state: TaskState) => {
    try {
      const adapter = deps.getAdapter(state.context.namespace);
      if (!adapter || !adapter.fetchReceipt) {
        stop(state.id);
        await deps.onError?.(state.id, new Error(`Adapter ${state.context.namespace} cannot fetch receipts.`));
        return;
      }

      const receiptResult = await adapter.fetchReceipt(state.context, state.hash);
      if (receiptResult) {
        stop(state.id);
        await deps.onReceipt(state.id, receiptResult);
        return;
      }

      if (adapter.detectReplacement) {
        const replacement = await adapter.detectReplacement(state.context);
        if (replacement) {
          stop(state.id);
          await deps.onReplacement(state.id, replacement);
          return;
        }
      }

      state.attempts += 1;
      if (state.attempts >= maxAttempts) {
        stop(state.id);
        await deps.onTimeout(state.id);
        return;
      }

      state.delay = Math.min(state.delay * 2, maxDelay);
      schedule(state);
    } catch (error) {
      stop(state.id);
      await deps.onError?.(state.id, error);
    }
  };

  const start = (id: string, context: TransactionAdapterContext, hash: string) => {
    if (tasks.has(id)) return;
    const state: TaskState = {
      id,
      context,
      hash,
      attempts: 0,
      delay: initialDelay,
      handle: null,
      active: true,
    };
    tasks.set(id, state);
    schedule(state);
  };

  /**
   * Restarts tracking from the initial delay (used after cold starts).
   * Attempts and backoff delay are reset, so the polling loop begins anew.
   */
  const resume = (id: string, context: TransactionAdapterContext, hash: string) => {
    stop(id);
    start(id, context, hash);
  };

  return {
    start,
    resume,
    stop,
    isTracking: (id) => tasks.has(id),
    pending: () => tasks.size,
  };
};
