import { DEFAULT_AUTO_LOCK_MS } from "./constants.js";
import type { UnlockController, UnlockControllerOptions, UnlockParams, UnlockReason, UnlockState } from "./types.js";

const UNLOCK_STATE_TOPIC = "unlock:stateChanged" as const;
const UNLOCK_LOCKED_TOPIC = "unlock:locked" as const;
const UNLOCK_UNLOCKED_TOPIC = "unlock:unlocked" as const;

const cloneState = (state: UnlockState): UnlockState => ({
  isUnlocked: state.isUnlocked,
  lastUnlockedAt: state.lastUnlockedAt,
  timeoutMs: state.timeoutMs,
  nextAutoLockAt: state.nextAutoLockAt,
});

const isSameState = (prev?: UnlockState, next?: UnlockState) => {
  if (!prev || !next) return false;
  return (
    prev.isUnlocked === next.isUnlocked &&
    prev.lastUnlockedAt === next.lastUnlockedAt &&
    prev.timeoutMs === next.timeoutMs &&
    prev.nextAutoLockAt === next.nextAutoLockAt
  );
};

const assertPositiveNumber = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.round(value);
};

type TimerId = ReturnType<typeof setTimeout>;

export class InMemoryUnlockController implements UnlockController {
  #messenger: UnlockControllerOptions["messenger"];
  #vault: UnlockControllerOptions["vault"];
  #state: UnlockState;
  #timerId: TimerId | null = null;
  #now: () => number;
  #setTimeout: typeof setTimeout;
  #clearTimeout: typeof clearTimeout;

  constructor(options: UnlockControllerOptions) {
    this.#messenger = options.messenger;
    this.#vault = options.vault;
    this.#now = options.now ?? (() => Date.now());
    // Bind native timer functions to globalThis to preserve correct `this` context
    // Without binding, calling `setTimeout` directly causes "Illegal invocation"
    this.#setTimeout = options.timers?.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.#clearTimeout = options.timers?.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);

    const initialTimeout = assertPositiveNumber(
      options.autoLockDurationMs ?? DEFAULT_AUTO_LOCK_MS,
      "Auto-lock duration",
    );
    const unlocked = this.#vault.isUnlocked();

    this.#state = {
      isUnlocked: unlocked,
      lastUnlockedAt: unlocked ? this.#now() : null,
      timeoutMs: initialTimeout,
      nextAutoLockAt: null,
    };

    if (unlocked) {
      this.scheduleAutoLock();
    }

    this.#publishState();
  }

  getState(): UnlockState {
    return cloneState(this.#state);
  }

  isUnlocked(): boolean {
    return this.#state.isUnlocked;
  }

  async unlock(params: UnlockParams): Promise<void> {
    await this.#vault.unlock(params);

    const timestamp = this.#now();
    this.#state = {
      ...this.#state,
      isUnlocked: true,
      lastUnlockedAt: timestamp,
    };
    this.scheduleAutoLock();
    this.#publishState();
    this.#messenger.publish(UNLOCK_UNLOCKED_TOPIC, { at: timestamp });
  }

  lock(reason: UnlockReason): void {
    if (!this.#state.isUnlocked) {
      return;
    }

    this.#clearAutoLockTimer();
    this.#vault.lock();

    const timestamp = this.#now();
    this.#state = {
      ...this.#state,
      isUnlocked: false,
      nextAutoLockAt: null,
    };

    this.#publishState();
    this.#messenger.publish(UNLOCK_LOCKED_TOPIC, { at: timestamp, reason });
  }

  scheduleAutoLock(duration?: number): number | null {
    if (!this.#state.isUnlocked) {
      this.#clearAutoLockTimer();
      this.#state = {
        ...this.#state,
        nextAutoLockAt: null,
      };
      return null;
    }

    const timeout = assertPositiveNumber(duration ?? this.#state.timeoutMs, "Auto-lock duration");
    this.#clearAutoLockTimer();

    const deadline = this.#now() + timeout;
    this.#timerId = this.#setTimeout(() => {
      this.#timerId = null;
      this.lock("timeout");
    }, timeout);

    this.#state = {
      ...this.#state,
      nextAutoLockAt: deadline,
    };
    this.#publishState();
    return deadline;
  }

  setAutoLockDuration(duration: number): void {
    const resolved = assertPositiveNumber(duration, "Auto-lock duration");
    if (resolved === this.#state.timeoutMs) {
      return;
    }

    this.#state = {
      ...this.#state,
      timeoutMs: resolved,
    };

    if (this.#state.isUnlocked) {
      this.scheduleAutoLock(resolved);
      return;
    }

    this.#state = {
      ...this.#state,
      nextAutoLockAt: null,
    };
    this.#publishState();
  }

  onStateChanged(handler: (state: UnlockState) => void) {
    return this.#messenger.subscribe(UNLOCK_STATE_TOPIC, handler);
  }

  onLocked(handler: (payload: { at: number; reason: UnlockReason }) => void) {
    return this.#messenger.subscribe(UNLOCK_LOCKED_TOPIC, handler);
  }

  onUnlocked(handler: (payload: { at: number }) => void) {
    return this.#messenger.subscribe(UNLOCK_UNLOCKED_TOPIC, handler);
  }

  #publishState() {
    this.#messenger.publish(UNLOCK_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }

  #clearAutoLockTimer() {
    if (this.#timerId !== null) {
      this.#clearTimeout(this.#timerId);
      this.#timerId = null;
    }
  }
}
