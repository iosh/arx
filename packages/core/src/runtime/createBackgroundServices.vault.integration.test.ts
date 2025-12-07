import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChainMetadata,
  FakeVault,
  setupBackground,
  TEST_AUTO_LOCK_DURATION,
  TEST_INITIAL_TIME,
} from "./__fixtures__/backgroundTestSetup.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (vault integration)", () => {
  it("persists unlock snapshot metadata for recovery workflows", async () => {
    const chain = createChainMetadata();
    let currentTime = TEST_INITIAL_TIME;
    const clock = () => currentTime;
    const vaultFactory = () => new FakeVault(clock);

    const first = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDuration: TEST_AUTO_LOCK_DURATION,
      persistDebounceMs: 0,
    });

    let persistedMeta = null;

    try {
      await first.services.session.vault.initialize({ password: "secret" });
      await first.services.session.unlock.unlock({ password: "secret" });
      const unlockedState = first.services.session.unlock.getState();
      expect(unlockedState.isUnlocked).toBe(true);
      expect(unlockedState.nextAutoLockAt).not.toBeNull();

      currentTime += 200;
      await first.services.session.persistVaultMeta();

      persistedMeta = first.storagePort.savedVaultMeta ?? null;
      expect(persistedMeta).not.toBeNull();
      expect(persistedMeta?.payload.unlockState?.isUnlocked).toBe(true);
      expect(persistedMeta?.payload.unlockState?.nextAutoLockAt).toBe(unlockedState.nextAutoLockAt);
    } finally {
      first.destroy();
    }

    const second = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDuration: TEST_AUTO_LOCK_DURATION,
      persistDebounceMs: 0,
      vaultMeta: persistedMeta,
    });

    try {
      const restoredMeta = second.services.session.getLastPersistedVaultMeta();
      expect(restoredMeta?.payload.unlockState).toEqual(persistedMeta?.payload.unlockState);

      const unlockState = second.services.session.unlock.getState();
      expect(unlockState.isUnlocked).toBe(false);
      expect(unlockState.timeoutMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(second.storagePort.savedVaultMeta).toBeNull();
    } finally {
      second.destroy();
    }
  });
});
