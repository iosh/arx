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

/** Owns the deadline for the current unlocked session; timers only wake the expiry check. */
export class AutoLockController {
  #durationMs: number;
  #deadline: number | null = null;
  #cancelScheduledLock: (() => void) | null = null;
  #onExpired: (() => void) | null = null;

  readonly #time: CoreTime;

  constructor(params: { durationMs: number; time: CoreTime }) {
    this.#durationMs = params.durationMs;
    this.#time = params.time;
  }

  getDuration(): number {
    return this.#durationMs;
  }

  isExpired(): boolean {
    return this.#deadline !== null && this.#time.now() >= this.#deadline;
  }

  applyDuration(durationMs: number): void {
    const deadline = this.#deadline;
    const previousDuration = this.#durationMs;
    this.#durationMs = durationMs;
    if (deadline === null || this.#time.now() >= deadline) return;

    const lastActivityAt = deadline - previousDuration;
    this.#deadline = lastActivityAt + durationMs;
    this.schedule();
  }

  start(onExpired: () => void): void {
    this.#onExpired = onExpired;
    this.#deadline = this.#time.now() + this.#durationMs;
    this.schedule();
  }

  recordActivity(): void {
    const now = this.#time.now();
    if (this.#deadline === null || now >= this.#deadline) return;

    this.#deadline = now + this.#durationMs;
    this.schedule();
  }

  stop(): void {
    this.#cancelScheduledLock?.();
    this.#cancelScheduledLock = null;
    this.#deadline = null;
    this.#onExpired = null;
  }

  private schedule(): void {
    if (this.#deadline === null) return;

    this.#cancelScheduledLock?.();

    this.#cancelScheduledLock = this.#time.schedule(Math.max(0, this.#deadline - this.#time.now()), () => {
      this.#cancelScheduledLock = null;
      if (this.isExpired()) this.#onExpired?.();
      else this.schedule();
    });
  }
}
