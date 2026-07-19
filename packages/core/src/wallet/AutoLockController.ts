import type { CoreTime } from "../runtime/time.js";
import { AutoLockDurationOutOfRangeError } from "./errors.js";

export const DEFAULT_AUTO_LOCK_DURATION_MS = 15 * 60_000;
export const MIN_AUTO_LOCK_DURATION_MS = 60_000;
export const MAX_AUTO_LOCK_DURATION_MS = 60 * 60_000;

export const assertAutoLockDuration = (durationMs: number): void => {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < MIN_AUTO_LOCK_DURATION_MS ||
    durationMs > MAX_AUTO_LOCK_DURATION_MS
  ) {
    throw new AutoLockDurationOutOfRangeError(durationMs);
  }
};

/** Owns the scheduled lock task for the current unlocked session. */
export class AutoLockController {
  #durationMs: number;
  #cancelScheduledLock: (() => void) | null = null;
  #lock: (() => void) | null = null;

  readonly #time: CoreTime;

  constructor(params: { durationMs: number; time: CoreTime }) {
    this.#durationMs = params.durationMs;
    this.#time = params.time;
  }

  getDuration(): number {
    return this.#durationMs;
  }

  applyDuration(durationMs: number): void {
    this.#durationMs = durationMs;
    if (this.#cancelScheduledLock) this.schedule();
  }

  start(lock: () => void): void {
    this.#lock = lock;
    this.schedule();
  }

  recordActivity(): void {
    if (this.#cancelScheduledLock) this.schedule();
  }

  stop(): void {
    this.#cancelScheduledLock?.();
    this.#cancelScheduledLock = null;
    this.#lock = null;
  }

  private schedule(): void {
    const lock = this.#lock;
    if (!lock) return;

    this.#cancelScheduledLock?.();

    this.#cancelScheduledLock = this.#time.schedule(this.#durationMs, () => {
      this.#cancelScheduledLock = null;
      lock();
    });
  }
}
