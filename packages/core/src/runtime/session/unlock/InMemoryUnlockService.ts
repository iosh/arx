import { OWNER_CHANGED } from "../../../events/ownerChanged.js";
import { SessionLockInvariantError } from "../errors.js";
import { DEFAULT_AUTO_LOCK_MS } from "./constants.js";
import { UNLOCK_LOCKED, UNLOCK_STATE_CHANGED, UNLOCK_UNLOCKED } from "./topics.js";
import type { SessionLockState, UnlockParams, UnlockReason, UnlockService, UnlockServiceOptions } from "./types.js";

const cloneState = (state: SessionLockState): SessionLockState => {
  if (state.status === "unlocked") {
    return {
      status: "unlocked",
      unlockedAt: state.unlockedAt,
      autoLockDurationMs: state.autoLockDurationMs,
      nextAutoLockAt: state.nextAutoLockAt,
    };
  }

  return {
    status: state.status,
    autoLockDurationMs: state.autoLockDurationMs,
    nextAutoLockAt: null,
  };
};

const areSessionLockStatesEqual = (prev: SessionLockState, next: SessionLockState) => {
  if (prev.status !== next.status) return false;
  if (prev.autoLockDurationMs !== next.autoLockDurationMs) return false;
  if (prev.nextAutoLockAt !== next.nextAutoLockAt) return false;

  if (prev.status === "unlocked" && next.status === "unlocked") {
    return prev.unlockedAt === next.unlockedAt;
  }

  return true;
};

const assertPositiveNumber = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return Math.round(value);
};

const buildClosedState = (params: {
  vaultStatus: "uninitialized" | "locked";
  autoLockDurationMs: number;
}): SessionLockState => ({
  status: params.vaultStatus,
  autoLockDurationMs: params.autoLockDurationMs,
  nextAutoLockAt: null,
});

type TimerId = ReturnType<typeof setTimeout>;

export class InMemoryUnlockService implements UnlockService {
  #messenger: UnlockServiceOptions["messenger"];
  #vault: UnlockServiceOptions["vault"];
  #state: SessionLockState;
  #timerId: TimerId | null = null;
  #now: () => number;
  #setTimeout: typeof setTimeout;
  #clearTimeout: typeof clearTimeout;
  #lastPublishedState: SessionLockState | null = null;

  constructor(options: UnlockServiceOptions) {
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
    const vaultStatus = this.#vault.getStatus();
    if (vaultStatus === "unlocked") {
      const timestamp = this.#now();
      this.#state = {
        status: "unlocked",
        unlockedAt: timestamp,
        autoLockDurationMs: initialTimeout,
        nextAutoLockAt: this.#armAutoLockTimer(initialTimeout, timestamp),
      };
    } else {
      this.#state = buildClosedState({
        vaultStatus,
        autoLockDurationMs: initialTimeout,
      });
    }

    this.#publishState();
  }

  getState(): SessionLockState {
    return cloneState(this.#state);
  }

  isUnlocked(): boolean {
    return this.#state.status === "unlocked";
  }

  async unlock(params: UnlockParams): Promise<void> {
    await this.#vault.unlock(params);

    const timestamp = this.#now();
    const autoLockDurationMs = this.#state.autoLockDurationMs;
    this.#state = {
      status: "unlocked",
      unlockedAt: timestamp,
      autoLockDurationMs,
      nextAutoLockAt: this.#armAutoLockTimer(autoLockDurationMs, timestamp),
    };
    this.#publishState();
    this.#messenger.publish(UNLOCK_UNLOCKED, { at: timestamp });
  }

  lock(reason: UnlockReason): void {
    if (this.#state.status !== "unlocked") {
      return;
    }

    this.#clearAutoLockTimer();
    this.#vault.lock();

    const timestamp = this.#now();
    const vaultStatus = this.#vault.getStatus();
    if (vaultStatus === "unlocked") {
      throw new SessionLockInvariantError({
        invariant: "vault_must_be_closed_after_session_lock",
      });
    }

    this.#state = buildClosedState({
      vaultStatus,
      autoLockDurationMs: this.#state.autoLockDurationMs,
    });

    this.#publishState();
    this.#messenger.publish(UNLOCK_LOCKED, { at: timestamp, reason });
  }

  syncVaultStatus(): SessionLockState {
    const vaultStatus = this.#vault.getStatus();
    const autoLockDurationMs = this.#state.autoLockDurationMs;

    if (vaultStatus === "unlocked") {
      if (this.#state.status === "unlocked") {
        return this.getState();
      }

      const timestamp = this.#now();
      this.#state = {
        status: "unlocked",
        unlockedAt: timestamp,
        autoLockDurationMs,
        nextAutoLockAt: this.#armAutoLockTimer(autoLockDurationMs, timestamp),
      };
      this.#publishState();
      return this.getState();
    }

    this.#clearAutoLockTimer();
    this.#state = buildClosedState({ vaultStatus, autoLockDurationMs });
    this.#publishState();
    return this.getState();
  }

  scheduleAutoLock(duration?: number): number | null {
    if (this.#state.status !== "unlocked") {
      this.#clearAutoLockTimer();
      return null;
    }

    const timeout = assertPositiveNumber(duration ?? this.#state.autoLockDurationMs, "Auto-lock duration");
    const deadline = this.#armAutoLockTimer(timeout);
    this.#state = {
      ...this.#state,
      nextAutoLockAt: deadline,
    };
    this.#publishState();
    return deadline;
  }

  setAutoLockDuration(duration: number): void {
    const resolved = assertPositiveNumber(duration, "Auto-lock duration");
    if (resolved === this.#state.autoLockDurationMs) {
      return;
    }

    if (this.#state.status === "unlocked") {
      this.#state = {
        ...this.#state,
        autoLockDurationMs: resolved,
        nextAutoLockAt: this.#armAutoLockTimer(resolved),
      };
      this.#publishState();
      return;
    }

    this.#state = {
      ...this.#state,
      autoLockDurationMs: resolved,
      nextAutoLockAt: null,
    };
    this.#publishState();
  }

  onStateChanged(handler: (state: SessionLockState) => void) {
    return this.#messenger.subscribe(UNLOCK_STATE_CHANGED, handler);
  }

  onLocked(handler: (payload: { at: number; reason: UnlockReason }) => void) {
    return this.#messenger.subscribe(UNLOCK_LOCKED, handler);
  }

  onUnlocked(handler: (payload: { at: number }) => void) {
    return this.#messenger.subscribe(UNLOCK_UNLOCKED, handler);
  }

  #publishState() {
    const next = cloneState(this.#state);
    if (this.#lastPublishedState && areSessionLockStatesEqual(this.#lastPublishedState, next)) {
      return;
    }

    this.#lastPublishedState = cloneState(next);
    this.#messenger.publish(UNLOCK_STATE_CHANGED, next);
    this.#messenger.publish(OWNER_CHANGED, { topic: "session", change: "state" });
  }

  #armAutoLockTimer(timeout: number, timestamp = this.#now()) {
    this.#clearAutoLockTimer();
    const deadline = timestamp + timeout;
    this.#timerId = this.#setTimeout(() => {
      this.#timerId = null;
      this.lock("timeout");
    }, timeout);
    return deadline;
  }

  #clearAutoLockTimer() {
    if (this.#timerId !== null) {
      this.#clearTimeout(this.#timerId);
      this.#timerId = null;
    }
  }
}
