import type {
  ReceiptResolution,
  ReplacementResolution,
  TransactionAdapter,
  TransactionTrackingContext,
} from "../adapters/types.js";

type TrackerAdapter = Pick<TransactionAdapter, "receiptTracking">;

type TrackerDeps = {
  getAdapter(namespace: string): TrackerAdapter | undefined;
  onReceipt(id: string, resolution: ReceiptResolution): void | Promise<void>;
  onReplacement(id: string, resolution: ReplacementResolution): void | Promise<void>;
  onTimeout(id: string): void | Promise<void>;
  /**
   * Receipt tracking is unsupported (adapter missing or does not implement receipt tracking).
   * This is treated as a terminal outcome for the tracking task.
   */
  onUnsupported(id: string, error: unknown): void | Promise<void>;
  /**
   * Non-fatal errors while polling receipts/replacements. Tracking continues with backoff.
   * Useful for logging/diagnostics.
   */
  onTransientError?(id: string, error: unknown): void | Promise<void>;
};
type TrackerOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
};

type TaskState = {
  id: string;
  context: TransactionTrackingContext;
  attempts: number;
  delay: number;
  handle: ReturnType<typeof setTimeout> | null;
  active: boolean;
};

const DEFAULT_INITIAL_DELAY_MS = 3_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 20;

export type ReceiptTracker = {
  start(id: string, context: TransactionTrackingContext): void;
  resume(id: string, context: TransactionTrackingContext): void;
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
    const handleTransientError = async (error: unknown) => {
      try {
        await deps.onTransientError?.(state.id, error);
      } catch {
        // Swallow observer errors; tracking should continue.
      }
    };

    try {
      const adapter = deps.getAdapter(state.context.namespace);
      const receiptTracking = adapter?.receiptTracking;
      if (!receiptTracking) {
        stop(state.id);
        await deps.onUnsupported(state.id, new Error(`Adapter ${state.context.namespace} cannot fetch receipts.`));
        return;
      }

      let receiptResult: ReceiptResolution | null = null;
      try {
        receiptResult = await receiptTracking.fetchReceipt(state.context);
      } catch (error) {
        await handleTransientError(error);
      }

      if (receiptResult) {
        stop(state.id);
        await deps.onReceipt(state.id, receiptResult);
        return;
      }

      if (receiptTracking.detectReplacement) {
        let replacement: ReplacementResolution | null = null;
        try {
          replacement = await receiptTracking.detectReplacement(state.context);
        } catch (error) {
          await handleTransientError(error);
        }

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
      // Defensive: unexpected errors should not permanently hang a broadcast tx in `broadcast`.
      // Treat as transient and continue retrying until timeout.
      await handleTransientError(error);

      if (!state.active) return;

      state.attempts += 1;
      if (state.attempts >= maxAttempts) {
        stop(state.id);
        await deps.onTimeout(state.id);
        return;
      }

      state.delay = Math.min(state.delay * 2, maxDelay);
      schedule(state);
    }
  };

  const start = (id: string, context: TransactionTrackingContext) => {
    if (tasks.has(id)) return;
    const state: TaskState = {
      id,
      context,
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
  const resume = (id: string, context: TransactionTrackingContext) => {
    stop(id);
    start(id, context);
  };

  return {
    start,
    resume,
    stop,
    isTracking: (id) => tasks.has(id),
    pending: () => tasks.size,
  };
};
