import { describe, expect, it, vi } from "vitest";
import { restoreUnlockState, type UnlockStateSnapshot } from "./unlockRecovery";

const createController = (state: {
  isUnlocked: boolean;
  lastUnlockedAt: number | null;
  nextAutoLockAt: number | null;
  timeoutMs: number;
}) => {
  const current = { ...state };
  return {
    getState: () => ({ ...current }),
    isUnlocked: () => current.isUnlocked,
    lock: vi.fn(),
    scheduleAutoLock: vi.fn(),
  };
};

describe("restoreUnlockState", () => {
  it("locks when persisted deadline already passed", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 1_500,
      timeoutMs: 10_000,
    });

    const snapshot: UnlockStateSnapshot = {
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 1_500,
    };

    restoreUnlockState({ controller, snapshot, now: () => 2_000, snapshotCapturedAt: 1_500 });

    expect(controller.lock).toHaveBeenCalledWith("timeout");
    expect(controller.scheduleAutoLock).not.toHaveBeenCalled();
  });

  it("re-schedules timer when still unlocked and deadline in the future", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 2_500,
      timeoutMs: 10_000,
    });

    restoreUnlockState({
      controller,
      snapshot: { isUnlocked: true, lastUnlockedAt: 1_000, nextAutoLockAt: 2_500 },
      now: () => 1_500,
      snapshotCapturedAt: 1_500,
    });

    expect(controller.lock).not.toHaveBeenCalled();
    expect(controller.scheduleAutoLock).toHaveBeenCalledWith(1_000);
  });

  it("locks with suspend when snapshot says locked but controller is unlocked", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 2_000,
      timeoutMs: 10_000,
    });

    restoreUnlockState({
      controller,
      snapshot: { isUnlocked: false, lastUnlockedAt: 1_000, nextAutoLockAt: null },
      now: () => 1_500,
      snapshotCapturedAt: 1_500,
    });

    expect(controller.lock).toHaveBeenCalledWith("suspend");
    expect(controller.scheduleAutoLock).not.toHaveBeenCalled();
  });
  it("falls back to lastUnlockedAt when deadline missing", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: null,
      timeoutMs: 10_000,
    });

    restoreUnlockState({
      controller,
      snapshot: { isUnlocked: true, lastUnlockedAt: 1_000, nextAutoLockAt: null },
      now: () => 6_000,
      snapshotCapturedAt: 1_500,
    });

    expect(controller.lock).not.toHaveBeenCalled();
    expect(controller.scheduleAutoLock).toHaveBeenCalledWith(5_000);
  });

  it("locks when snapshot is stale beyond timeout", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 5_000,
      timeoutMs: 10_000,
    });

    restoreUnlockState({
      controller,
      snapshot: {
        isUnlocked: true,
        lastUnlockedAt: 1_000,
        nextAutoLockAt: 5_000,
      },
      snapshotCapturedAt: 0,
      now: () => 15_100,
    });

    expect(controller.lock).toHaveBeenCalledWith("timeout");
    expect(controller.scheduleAutoLock).not.toHaveBeenCalled();
  });

  it("keeps controller locked when snapshot is unlocked but current state is locked", () => {
    const controller = createController({
      isUnlocked: false,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 2_000,
      timeoutMs: 10_000,
    });

    restoreUnlockState({
      controller,
      snapshot: {
        isUnlocked: true,
        lastUnlockedAt: 1_000,
        nextAutoLockAt: 2_000,
      },
      snapshotCapturedAt: 1_500,
      now: () => 1_600,
    });

    expect(controller.lock).not.toHaveBeenCalled();
    expect(controller.scheduleAutoLock).not.toHaveBeenCalled();
  });

  it("caps rescheduled timeout to current timeoutMs", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 50,
      nextAutoLockAt: 50 + 60_000,
      timeoutMs: 30_000,
    });

    restoreUnlockState({
      controller,
      snapshot: {
        isUnlocked: true,
        lastUnlockedAt: 50,
        nextAutoLockAt: 50 + 120_000,
      },
      snapshotCapturedAt: 60_000,
      now: () => 65_000,
    });

    expect(controller.scheduleAutoLock).toHaveBeenCalledWith(30_000);
  });

  it("clamps negative elapsed time when clock drifts backwards", () => {
    const controller = createController({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 2_000,
      timeoutMs: 10_000,
    });

    const snapshot: UnlockStateSnapshot = {
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      nextAutoLockAt: 2_000,
    };

    restoreUnlockState({
      controller,
      snapshot,
      snapshotCapturedAt: 2_000,
      now: () => 1_500,
    });

    expect(controller.lock).not.toHaveBeenCalled();
    expect(controller.scheduleAutoLock).toHaveBeenCalledWith(500);
  });
});
