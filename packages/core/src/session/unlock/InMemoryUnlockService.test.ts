import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessenger } from "../../messenger/index.js";
import { InMemoryUnlockService } from "./InMemoryUnlockService.js";
import { UNLOCK_LOCKED, UNLOCK_STATE_CHANGED, UNLOCK_UNLOCKED } from "./topics.js";
import type { SessionLockState, UnlockLockedPayload, UnlockUnlockedPayload } from "./types.js";

describe("InMemoryUnlockService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unlocks the vault, emits events, and schedules auto lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const messenger = createMessenger();
    const stateUpdates: SessionLockState[] = [];
    const lockedEvents: UnlockLockedPayload[] = [];
    const unlockedEvents: UnlockUnlockedPayload[] = [];

    messenger.subscribe(UNLOCK_STATE_CHANGED, (state) => stateUpdates.push(state));
    messenger.subscribe(UNLOCK_LOCKED, (payload) => lockedEvents.push(payload));
    messenger.subscribe(UNLOCK_UNLOCKED, (payload) => unlockedEvents.push(payload));

    let vaultUnlocked = false;
    const vaultUnlock = vi.fn(async () => {
      vaultUnlocked = true;
    });
    const vaultLock = vi.fn(() => {
      vaultUnlocked = false;
    });

    const unlockService = new InMemoryUnlockService({
      messenger,
      vault: {
        unlock: vaultUnlock,
        lock: vaultLock,
        getStatus: () => (vaultUnlocked ? "unlocked" : "locked"),
      },
      autoLockDurationMs: 500,
    });

    expect(stateUpdates).toEqual([
      {
        status: "locked",
        autoLockDurationMs: 500,
        nextAutoLockAt: null,
      },
    ]);

    await unlockService.unlock({ password: "secret" });

    expect(vaultUnlock).toHaveBeenCalledWith({ password: "secret" });
    expect(unlockService.isUnlocked()).toBe(true);
    expect(unlockedEvents).toEqual([{ at: 1_000 }]);
    expect(stateUpdates.at(-1)).toMatchObject({
      status: "unlocked",
      unlockedAt: 1_000,
      autoLockDurationMs: 500,
      nextAutoLockAt: 1_500,
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(vaultLock).toHaveBeenCalledTimes(1);
    expect(unlockService.isUnlocked()).toBe(false);
    expect(lockedEvents).toEqual([{ at: 1_500, reason: "timeout" }]);
    expect(stateUpdates.at(-1)).toEqual({
      status: "locked",
      autoLockDurationMs: 500,
      nextAutoLockAt: null,
    });
  });

  it("reconfigures auto-lock duration while unlocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const messenger = createMessenger();
    const stateUpdates: SessionLockState[] = [];
    messenger.subscribe(UNLOCK_STATE_CHANGED, (state) => stateUpdates.push(state));

    const unlockService = new InMemoryUnlockService({
      messenger,
      vault: {
        unlock: vi.fn(async () => {}),
        lock: vi.fn(),
        getStatus: () => "locked",
      },
      autoLockDurationMs: 600,
    });

    await unlockService.unlock({ password: "pwd" });

    unlockService.setAutoLockDuration(1_200);

    expect(unlockService.getState().autoLockDurationMs).toBe(1_200);
    expect(stateUpdates.at(-1)).toMatchObject({
      autoLockDurationMs: 1_200,
      nextAutoLockAt: 6_200,
    });
  });

  it("stays locked when vault unlock throws", async () => {
    const messenger = createMessenger();
    const stateUpdates: SessionLockState[] = [];
    messenger.subscribe(UNLOCK_STATE_CHANGED, (state) => stateUpdates.push(state));

    const vaultUnlock = vi.fn(async () => {
      throw new Error("unlock failed");
    });

    const unlockService = new InMemoryUnlockService({
      messenger,
      vault: {
        unlock: vaultUnlock,
        lock: vi.fn(),
        getStatus: () => "locked",
      },
      autoLockDurationMs: 1_000,
    });

    await expect(unlockService.unlock({ password: "secret" })).rejects.toThrow("unlock failed");

    expect(unlockService.isUnlocked()).toBe(false);
    expect(stateUpdates.at(-1)).toMatchObject({
      status: "locked",
      nextAutoLockAt: null,
    });
  });

  it("syncs uninitialized and locked statuses from the vault envelope state", () => {
    const messenger = createMessenger();
    const stateUpdates: SessionLockState[] = [];
    messenger.subscribe(UNLOCK_STATE_CHANGED, (state) => stateUpdates.push(state));

    let hasEnvelope = false;
    const unlockService = new InMemoryUnlockService({
      messenger,
      vault: {
        unlock: vi.fn(async () => {}),
        lock: vi.fn(),
        getStatus: () => (hasEnvelope ? "locked" : "uninitialized"),
      },
      autoLockDurationMs: 1_000,
    });

    expect(unlockService.getState()).toEqual({
      status: "uninitialized",
      autoLockDurationMs: 1_000,
      nextAutoLockAt: null,
    });

    hasEnvelope = true;

    expect(unlockService.syncVaultStatus()).toEqual({
      status: "locked",
      autoLockDurationMs: 1_000,
      nextAutoLockAt: null,
    });
    expect(stateUpdates.at(-1)?.status).toBe("locked");
  });
});
