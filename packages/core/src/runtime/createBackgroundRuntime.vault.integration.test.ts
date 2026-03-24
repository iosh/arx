import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUiSessionAccess } from "../ui/server/sessionAccess.js";
import {
  createChainMetadata,
  FakeVault,
  setupBackground,
  TEST_AUTO_LOCK_DURATION,
  TEST_INITIAL_TIME,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { decodePayload, encodePayload } from "./keyring/keyring-utils.js";

const TEST_PRIVATE_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
const CORRUPTED_PRIVATE_KEY = "2222222222222222222222222222222222222222222222222222222222222222";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundRuntime (vault integration)", () => {
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
      await first.runtime.services.session.vault.initialize({ password: "secret" });
      await first.runtime.services.session.unlock.unlock({ password: "secret" });
      const unlockedState = first.runtime.services.session.unlock.getState();
      expect(unlockedState.isUnlocked).toBe(true);
      expect(unlockedState.nextAutoLockAt).not.toBeNull();

      currentTime += 200;
      await first.runtime.services.session.persistVaultMeta();

      persistedMeta = first.vaultMetaPort.savedVaultMeta ?? null;
      expect(persistedMeta).not.toBeNull();
      expect(persistedMeta?.payload.envelope).not.toBeNull();
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
      const restoredMeta = second.runtime.services.session.getLastPersistedVaultMeta();
      expect(restoredMeta?.payload.envelope).toEqual(persistedMeta?.payload.envelope);
      expect(restoredMeta?.payload.autoLockDurationMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(restoredMeta?.payload.initializedAt).toBe(TEST_INITIAL_TIME);

      const unlockState = second.runtime.services.session.unlock.getState();
      expect(unlockState.isUnlocked).toBe(false);
      expect(unlockState.timeoutMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(second.vaultMetaPort.savedVaultMeta).toBeNull();
    } finally {
      second.destroy();
    }
  });

  it("fails closed when unlock hydration cannot materialize a persisted keyring", async () => {
    const chain = createChainMetadata();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      const sessionAccess = createUiSessionAccess({
        accounts: context.runtime.controllers.accounts,
        session: context.runtime.services.session,
        sessionStatus: context.runtime.services.sessionStatus,
        keyring: context.runtime.services.keyring,
      });

      await context.runtime.services.session.vault.initialize({ password: "secret" });
      await sessionAccess.unlock({ password: "secret" });
      await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      const payload = decodePayload(context.runtime.services.session.vault.exportSecret());
      const [entry] = payload.keyrings;
      if (!entry || entry.type !== "hd") {
        throw new Error("Expected persisted HD keyring payload");
      }

      entry.payload = { mnemonic: new Array(12).fill("invalid") };
      await context.runtime.services.session.vault.commitSecret({ secret: encodePayload(payload) });
      sessionAccess.lock("manual");

      await expect(sessionAccess.unlock({ password: "secret" })).rejects.toThrow();
      expect(sessionAccess.isUnlocked()).toBe(false);
      expect(context.runtime.services.session.vault.isUnlocked()).toBe(false);
    } finally {
      context.destroy();
    }
  });

  it("fails closed when a persisted private-key account no longer matches its secret", async () => {
    const chain = createChainMetadata();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      const sessionAccess = createUiSessionAccess({
        accounts: context.runtime.controllers.accounts,
        session: context.runtime.services.session,
        sessionStatus: context.runtime.services.sessionStatus,
        keyring: context.runtime.services.keyring,
      });

      await context.runtime.services.session.vault.initialize({ password: "secret" });
      await sessionAccess.unlock({ password: "secret" });
      await context.runtime.services.keyring.importPrivateKey({ privateKey: TEST_PRIVATE_KEY });

      const payload = decodePayload(context.runtime.services.session.vault.exportSecret());
      const [entry] = payload.keyrings;
      if (!entry || entry.type !== "private-key") {
        throw new Error("Expected persisted private-key payload");
      }

      entry.payload = { privateKey: CORRUPTED_PRIVATE_KEY };
      await context.runtime.services.session.vault.commitSecret({ secret: encodePayload(payload) });
      sessionAccess.lock("manual");

      await expect(sessionAccess.unlock({ password: "secret" })).rejects.toThrow();
      expect(sessionAccess.isUnlocked()).toBe(false);
      expect(context.runtime.services.session.vault.isUnlocked()).toBe(false);
    } finally {
      context.destroy();
    }
  });
});
