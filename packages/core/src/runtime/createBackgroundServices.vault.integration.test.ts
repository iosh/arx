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
  it("persists vault metadata for recovery workflows", async () => {
    const chain = createChainMetadata();
    let currentTime = TEST_INITIAL_TIME;
    const clock = () => currentTime;
    const vaultFactory = () => new FakeVault(clock);

    const first = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDurationMs: TEST_AUTO_LOCK_DURATION,
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

      persistedMeta = first.vaultMetaPort.savedVaultMeta ?? null;
      expect(persistedMeta).not.toBeNull();
      expect(persistedMeta?.payload.ciphertext).not.toBeNull();
      expect(persistedMeta?.payload.autoLockDurationMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(persistedMeta?.payload.initializedAt).toBe(TEST_INITIAL_TIME);
    } finally {
      first.destroy();
    }

    const second = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: vaultFactory,
      autoLockDurationMs: TEST_AUTO_LOCK_DURATION,
      persistDebounceMs: 0,
      vaultMeta: persistedMeta,
    });

    try {
      const restoredMeta = second.services.session.getLastPersistedVaultMeta();
      expect(restoredMeta?.payload.ciphertext).toEqual(persistedMeta?.payload.ciphertext);
      expect(restoredMeta?.payload.autoLockDurationMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(restoredMeta?.payload.initializedAt).toBe(TEST_INITIAL_TIME);

      const unlockState = second.services.session.unlock.getState();
      expect(unlockState.isUnlocked).toBe(false);
      expect(unlockState.timeoutMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(second.vaultMetaPort.savedVaultMeta).toBeNull();
    } finally {
      second.destroy();
    }
  });
});
