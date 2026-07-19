import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemTime } from "../runtime/time.js";
import { AutoLockController } from "./AutoLockController.js";

beforeEach(() => vi.useFakeTimers());
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

  it("cancels the scheduled lock when the session stops", async () => {
    const lock = vi.fn();
    const autoLock = new AutoLockController({ durationMs: 60_000, time: systemTime });
    autoLock.start(lock);

    autoLock.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(lock).not.toHaveBeenCalled();
  });
});
