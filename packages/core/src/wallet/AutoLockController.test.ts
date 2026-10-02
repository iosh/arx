import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemTime } from "../runtime/time.js";
import { AutoLockController } from "./AutoLockController.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("AutoLockController", () => {
  it("reschedules an active session after trusted activity", async () => {
    const lock = vi.fn();
    const autoLock = new AutoLockController({ durationMs: 60_000, time: systemTime });
    autoLock.start(lock);

    await vi.advanceTimersByTimeAsync(30_000);
    autoLock.recordActivity();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(lock).toHaveBeenCalledOnce();
  });

  it("does not revive an expired session when its timer has not run", () => {
    const lock = vi.fn();
    const autoLock = new AutoLockController({ durationMs: 60_000, time: systemTime });
    autoLock.start(lock);

    vi.setSystemTime(60_000);
    autoLock.recordActivity();
    autoLock.applyDuration(120_000);

    expect(autoLock.isExpired()).toBe(true);
    expect(lock).not.toHaveBeenCalled();
  });

  it("changes duration without treating the settings update as activity", async () => {
    const lock = vi.fn();
    const autoLock = new AutoLockController({ durationMs: 120_000, time: systemTime });
    autoLock.start(lock);
    await vi.advanceTimersByTimeAsync(30_000);
    autoLock.recordActivity();
    await vi.advanceTimersByTimeAsync(20_000);

    autoLock.applyDuration(180_000);
    // The last activity was at 30s, so the new deadline is 210s, not 230s.
    await vi.advanceTimersByTimeAsync(159_999);
    expect(lock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lock).toHaveBeenCalledOnce();
  });
});
