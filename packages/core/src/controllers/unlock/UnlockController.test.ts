import { describe, expect, it, vi } from "vitest";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { UnlockLockedPayload, UnlockMessengerTopics, UnlockState, UnlockUnlockedPayload } from "./types.js";
import { InMemoryUnlockController } from "./UnlockController.js";

const createMessenger = () => new ControllerMessenger<UnlockMessengerTopics>({});

describe("InMemoryUnlockController", () => {
  it("unlocks the vault, emits events, and schedules auto lock", async () => {
    const messenger = createMessenger();
    const stateUpdates: UnlockState[] = [];
    const lockedEvents: UnlockLockedPayload[] = [];
    const unlockedEvents: UnlockUnlockedPayload[] = [];

    messenger.subscribe("session:stateChanged", (state) => stateUpdates.push(state));
    messenger.subscribe("session:locked", (payload) => lockedEvents.push(payload));
    messenger.subscribe("session:unlocked", (payload) => unlockedEvents.push(payload));

    let now = 1_000;
    let triggerTimeout: (() => void) | null = () => {};

    const setTimeoutSpy = vi.fn((handler: () => void, timeout: number) => {
      expect(timeout).toBe(500);
      triggerTimeout = handler;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.fn(() => {
      triggerTimeout = null;
    });

    const timers = {
      setTimeout: setTimeoutSpy as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
    };

    const vaultUnlock = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const vaultLock = vi.fn();

    const controller = new InMemoryUnlockController({
      messenger,
      vault: {
        unlock: vaultUnlock,
        lock: vaultLock,
        isUnlocked: () => false,
      },
      autoLockDuration: 500,
      now: () => now,
      timers,
    });

    expect(stateUpdates).toEqual([
      {
        isUnlocked: false,
        lastUnlockedAt: null,
        timeoutMs: 500,
        nextAutoLockAt: null,
      },
    ]);

    await controller.unlock({ password: "secret" });

    expect(vaultUnlock).toHaveBeenCalledWith({ password: "secret" });
    expect(controller.isUnlocked()).toBe(true);
    expect(unlockedEvents).toEqual([{ at: 1_000 }]);
    expect(stateUpdates.at(-1)).toMatchObject({
      isUnlocked: true,
      lastUnlockedAt: 1_000,
      timeoutMs: 500,
      nextAutoLockAt: 1_500,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    now = 1_500;
    triggerTimeout?.();

    expect(vaultLock).toHaveBeenCalledTimes(1);
    expect(controller.isUnlocked()).toBe(false);
    expect(lockedEvents).toEqual([{ at: 1_500, reason: "timeout" }]);
    expect(stateUpdates.at(-1)).toEqual({
      isUnlocked: false,
      lastUnlockedAt: 1_000,
      timeoutMs: 500,
      nextAutoLockAt: null,
    });
  });

  it("reconfigures auto-lock duration while unlocked", async () => {
    const messenger = createMessenger();
    const stateUpdates: UnlockState[] = [];
    messenger.subscribe("session:stateChanged", (state) => stateUpdates.push(state));

    const now = 5_000;

    const setTimeoutSpy = vi.fn((handler: () => void, timeout: number) => {
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.fn();

    const timers = {
      setTimeout: setTimeoutSpy as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
    };

    const controller = new InMemoryUnlockController({
      messenger,
      vault: {
        unlock: vi.fn(async () => new Uint8Array([7])),
        lock: vi.fn(),
        isUnlocked: () => false,
      },
      autoLockDuration: 600,
      now: () => now,
      timers,
    });

    await controller.unlock({ password: "pwd" });

    setTimeoutSpy.mockClear();
    clearTimeoutSpy.mockClear();

    controller.setAutoLockDuration(1_200);

    expect(controller.getState().timeoutMs).toBe(1_200);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_200);
    expect(stateUpdates.at(-1)).toMatchObject({
      timeoutMs: 1_200,
      nextAutoLockAt: now + 1_200,
    });
  });
});
