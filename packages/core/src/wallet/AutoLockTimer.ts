import { AutoLockDurationOutOfRangeError } from "../settings/errors.js";

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

/** Owns the deadline and timer for the current unlocked period. */
export class AutoLockTimer {
  #durationMs: number;
  #deadline: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #onExpire: () => void;

  constructor(params: { durationMs: number; onExpire: () => void }) {
    assertAutoLockDuration(params.durationMs);
    this.#durationMs = params.durationMs;
    this.#onExpire = params.onExpire;
  }

  getDuration(): number {
    return this.#durationMs;
  }

  getDeadline(): number | null {
    return this.#deadline;
  }

  updateDuration(durationMs: number): void {
    assertAutoLockDuration(durationMs);
    this.#durationMs = durationMs;
    if (this.#timer) this.restart();
  }

  start(): void {
    this.stop();
    this.#deadline = Date.now() + this.#durationMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#deadline = null;
      this.#onExpire();
    }, this.#durationMs);
  }

  restart(): void {
    if (this.#timer) this.start();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#deadline = null;
  }
}
