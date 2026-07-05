import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultMetaSnapshot } from "../storage/index.js";
import type { AccountRecord, KeyringMetaRecord } from "../storage/records.js";
import {
  createChainDefinition,
  FakeVault,
  MemoryAccountsPort,
  MemoryKeyringMetasPort,
  MemoryVaultMetaPort,
  setupBackground,
  TEST_AUTO_LOCK_DURATION,
  TEST_INITIAL_TIME,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { decodePayload, encodePayload } from "./keyring/keyring-utils.js";

const TEST_PRIVATE_KEY = "1111111111111111111111111111111111111111111111111111111111111111";
const CORRUPTED_PRIVATE_KEY = "2222222222222222222222222222222222222222222222222222222222222222";

type BackgroundContext = Awaited<ReturnType<typeof setupBackground>>;

const unlockSession = async (context: BackgroundContext, password: string) => {
  await context.runtime.services.session.unlock.unlock({ password });
  await context.runtime.services.keyring.waitForReady();
  return context.runtime.services.session.unlock.getState();
};

const lockSession = (context: BackgroundContext) => {
  context.runtime.services.session.unlock.lock("manual");
  return context.runtime.services.session.unlock.getState();
};

const isSessionUnlocked = (context: BackgroundContext) => context.runtime.services.session.isUnlocked();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundRuntime (vault integration)", () => {
  it("imports a vault without reviving an unlocked session", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const sourceVault = new FakeVault(clock);
    const envelope = await sourceVault.initialize({ password: "secret", secret: encodePayload({ keyrings: [] }) });

    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.importVault(envelope);

      expect(context.runtime.services.session.getStatus()).toMatchObject({
        status: "locked",
        vaultInitialized: true,
        isUnlocked: false,
      });
      expect(context.runtime.services.session.unlock.isUnlocked()).toBe(false);
      expect(context.runtime.services.session.vault.getStatus()).toBe("locked");
    } finally {
      context.destroy();
    }
  });

  it("rejects createVault while the session is unlocked", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await context.runtime.services.session.unlock.unlock({ password: "secret" });

      await expect(context.runtime.services.session.createVault({ password: "next-secret" })).rejects.toMatchObject({
        code: "global.rpc.invalid_request",
        message: "createVault requires the session to be locked",
      });

      expect(context.runtime.services.session.getStatus()).toMatchObject({
        status: "unlocked",
        vaultInitialized: true,
        isUnlocked: true,
      });
      expect(context.runtime.services.session.unlock.isUnlocked()).toBe(true);
      expect(context.runtime.services.session.vault.getStatus()).toBe("unlocked");
    } finally {
      context.destroy();
    }
  });

  it("rejects importVault while the session is unlocked", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const sourceVault = new FakeVault(clock);
    const envelope = await sourceVault.initialize({ password: "secret", secret: encodePayload({ keyrings: [] }) });

    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await context.runtime.services.session.unlock.unlock({ password: "secret" });

      await expect(context.runtime.services.session.importVault(envelope)).rejects.toMatchObject({
        code: "global.rpc.invalid_request",
        message: "importVault requires the session to be locked",
      });

      expect(context.runtime.services.session.getStatus()).toMatchObject({
        status: "unlocked",
        vaultInitialized: true,
        isUnlocked: true,
      });
      expect(context.runtime.services.session.unlock.isUnlocked()).toBe(true);
      expect(context.runtime.services.session.vault.getStatus()).toBe("unlocked");
    } finally {
      context.destroy();
    }
  });

  it("persists imported vault metadata before importVault resolves", async () => {
    const chain = createChainDefinition();
    let currentTime = TEST_INITIAL_TIME;
    const clock = () => currentTime;
    const sourceVault = new FakeVault(clock);
    const envelope = await sourceVault.initialize({ password: "secret", secret: encodePayload({ keyrings: [] }) });

    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
      persistDebounceMs: 30_000,
    });

    try {
      expect(context.vaultMetaPort.savedVaultMeta).toBeNull();

      currentTime += 50;
      await context.runtime.services.session.importVault(envelope);

      expect(context.vaultMetaPort.savedVaultMeta?.payload.envelope).toEqual(envelope);
      expect(context.runtime.services.session.getLastPersistedVaultMeta()?.payload.envelope).toEqual(envelope);
    } finally {
      context.destroy();
    }
  });

  it("persists vault metadata for recovery workflows", async () => {
    const chain = createChainDefinition();
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
      await first.runtime.services.session.createVault({ password: "secret" });
      await first.runtime.services.session.unlock.unlock({ password: "secret" });
      const unlockedState = first.runtime.services.session.unlock.getState();
      expect(unlockedState.status).toBe("unlocked");
      expect(unlockedState.nextAutoLockAt).toBeGreaterThan(currentTime);

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
      expect(unlockState.status).toBe("locked");
      expect(unlockState.autoLockDurationMs).toBe(TEST_AUTO_LOCK_DURATION);
      expect(second.vaultMetaPort.savedVaultMeta).toBeNull();
    } finally {
      second.destroy();
    }
  });

  it("fails boot without deleting projections when persisted vault metadata is invalid", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;

    const first = await setupBackground({
      chainSeed: [chain],
      now: clock,
      persistDebounceMs: 0,
    });

    let persistedMeta: VaultMetaSnapshot | null = null;
    let accountsSeed: AccountRecord[] = [];
    let keyringMetasSeed: KeyringMetaRecord[] = [];

    try {
      await first.runtime.services.session.createVault({ password: "secret" });
      await first.runtime.services.session.unlock.unlock({ password: "secret" });
      await first.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
      await first.runtime.services.session.persistVaultMeta();

      persistedMeta = first.vaultMetaPort.savedVaultMeta ?? null;
      accountsSeed = await first.accountsPort.list();
      keyringMetasSeed = await first.keyringMetasPort.list();
    } finally {
      first.destroy();
    }

    if (!persistedMeta?.payload.envelope) {
      throw new Error("Expected persisted vault envelope");
    }

    const corruptedMeta = structuredClone(persistedMeta);
    const corruptedEnvelope = structuredClone(persistedMeta.payload.envelope);
    (corruptedEnvelope as { version: number }).version = 999;
    corruptedMeta.payload.envelope = corruptedEnvelope;

    const accountsPort = new MemoryAccountsPort(accountsSeed);
    const keyringMetasPort = new MemoryKeyringMetasPort(keyringMetasSeed);
    const vaultMetaPort = new MemoryVaultMetaPort(corruptedMeta);

    await expect(
      setupBackground({
        chainSeed: [chain],
        now: clock,
        persistDebounceMs: 0,
        accountsPort,
        keyringMetasPort,
        vaultMetaPort,
      }),
    ).rejects.toMatchObject({
      code: "runtime.hydration_failed",
      details: {
        owner: "vault",
        resource: "vaultEnvelope",
      },
    });

    expect(vaultMetaPort.clearedVaultMeta).toBe(false);
    await expect(accountsPort.list()).resolves.toEqual(accountsSeed);
    await expect(keyringMetasPort.list()).resolves.toEqual(keyringMetasSeed);
  });

  it("fails closed without deleting projections when persisted keyrings exist but vault secret bytes are empty", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await unlockSession(context, "secret");
      await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      const accountsBefore = await context.accountsPort.list();
      const keyringMetasBefore = await context.keyringMetasPort.list();

      await context.runtime.services.session.vault.commitSecret({ secret: new Uint8Array() });
      lockSession(context);

      await expect(unlockSession(context, "secret")).rejects.toThrow();
      expect(isSessionUnlocked(context)).toBe(false);
      await expect(context.accountsPort.list()).resolves.toEqual(accountsBefore);
      await expect(context.keyringMetasPort.list()).resolves.toEqual(keyringMetasBefore);
    } finally {
      context.destroy();
    }
  });

  it("reseeds an empty keyring payload when vault secret bytes are empty and no projections exist", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await unlockSession(context, "secret");
      await context.runtime.services.session.vault.commitSecret({ secret: new Uint8Array() });
      lockSession(context);

      await expect(unlockSession(context, "secret")).resolves.toMatchObject({ status: "unlocked" });
      expect(decodePayload(context.runtime.services.session.vault.exportSecret())).toEqual({ keyrings: [] });
      await expect(context.accountsPort.list()).resolves.toEqual([]);
      await expect(context.keyringMetasPort.list()).resolves.toEqual([]);
    } finally {
      context.destroy();
    }
  });

  it("clears stale projections after a valid empty keyring payload hydrates", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await unlockSession(context, "secret");
      await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      await expect(context.accountsPort.list()).resolves.toHaveLength(1);
      await expect(context.keyringMetasPort.list()).resolves.toHaveLength(1);

      await context.runtime.services.session.vault.commitSecret({ secret: encodePayload({ keyrings: [] }) });
      lockSession(context);

      await expect(unlockSession(context, "secret")).resolves.toMatchObject({ status: "unlocked" });
      await expect(context.accountsPort.list()).resolves.toEqual([]);
      await expect(context.keyringMetasPort.list()).resolves.toEqual([]);
    } finally {
      context.destroy();
    }
  });

  it("fails closed when unlock hydration cannot materialize a persisted keyring", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await unlockSession(context, "secret");
      await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      const accountsBefore = await context.accountsPort.list();
      const keyringMetasBefore = await context.keyringMetasPort.list();

      const payload = decodePayload(context.runtime.services.session.vault.exportSecret());
      const [entry] = payload.keyrings;
      if (!entry || entry.type !== "hd") {
        throw new Error("Expected persisted HD keyring payload");
      }

      entry.payload = { mnemonic: new Array(12).fill("invalid") };
      await context.runtime.services.session.vault.commitSecret({ secret: encodePayload(payload) });
      lockSession(context);

      await expect(unlockSession(context, "secret")).rejects.toThrow();
      expect(isSessionUnlocked(context)).toBe(false);
      expect(context.runtime.services.session.vault.getStatus()).toBe("locked");
      await expect(context.accountsPort.list()).resolves.toEqual(accountsBefore);
      await expect(context.keyringMetasPort.list()).resolves.toEqual(keyringMetasBefore);
    } finally {
      context.destroy();
    }
  });

  it("fails closed when a persisted private-key account no longer matches its secret", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await unlockSession(context, "secret");
      await context.runtime.services.keyring.importPrivateKey({ privateKey: TEST_PRIVATE_KEY });

      const accountsBefore = await context.accountsPort.list();
      const keyringMetasBefore = await context.keyringMetasPort.list();

      const payload = decodePayload(context.runtime.services.session.vault.exportSecret());
      const [entry] = payload.keyrings;
      if (!entry || entry.type !== "private-key") {
        throw new Error("Expected persisted private-key payload");
      }

      entry.payload = { privateKey: CORRUPTED_PRIVATE_KEY };
      await context.runtime.services.session.vault.commitSecret({ secret: encodePayload(payload) });
      lockSession(context);

      await expect(unlockSession(context, "secret")).rejects.toThrow();
      expect(isSessionUnlocked(context)).toBe(false);
      expect(context.runtime.services.session.vault.getStatus()).toBe("locked");
      await expect(context.accountsPort.list()).resolves.toEqual(accountsBefore);
      await expect(context.keyringMetasPort.list()).resolves.toEqual(keyringMetasBefore);
    } finally {
      context.destroy();
    }
  });

  it("locks the session and clears runtime keyrings during destroy", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    await context.runtime.services.session.createVault({ password: "secret" });
    await context.runtime.services.session.unlock.unlock({ password: "secret" });
    await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

    expect(context.runtime.services.session.unlock.isUnlocked()).toBe(true);
    expect(context.runtime.services.session.vault.getStatus()).toBe("unlocked");
    expect(context.runtime.services.keyring.getKeyrings()).toHaveLength(1);

    context.destroy();

    expect(context.runtime.services.session.unlock.isUnlocked()).toBe(false);
    expect(context.runtime.services.session.vault.getStatus()).toBe("locked");
    expect(context.runtime.services.keyring.getKeyrings()).toEqual([]);
    expect(context.runtime.services.keyring.getAccounts(true)).toEqual([]);
  });

  it("rejects key material export and signing while locked", async () => {
    const chain = createChainDefinition();
    const clock = () => TEST_INITIAL_TIME;
    const context = await setupBackground({
      chainSeed: [chain],
      now: clock,
      vault: () => new FakeVault(clock),
    });

    try {
      await context.runtime.services.session.createVault({ password: "secret" });
      await context.runtime.services.session.unlock.unlock({ password: "secret" });

      const { keyringId, address } = await context.runtime.services.keyring.confirmNewMnemonic({
        mnemonic: TEST_MNEMONIC,
      });
      const [account] = context.runtime.services.keyring.getAccounts(true);
      if (!account) {
        throw new Error("Expected created account");
      }

      context.runtime.services.session.unlock.lock("manual");

      await expect(context.runtime.services.keyring.exportMnemonic(keyringId, "secret")).rejects.toMatchObject({
        code: "global.session.locked",
      });
      await expect(
        context.runtime.services.keyring.exportPrivateKey(chain.namespace, address, "secret"),
      ).rejects.toMatchObject({
        code: "global.session.locked",
      });
      await expect(
        context.runtime.services.keyring.exportPrivateKeyByAccountId(account.accountId, "secret"),
      ).rejects.toMatchObject({
        code: "global.session.locked",
      });
      await expect(
        context.runtime.services.keyring.signDigestByAccountId({
          accountId: account.accountId,
          digest: new Uint8Array(32),
        }),
      ).rejects.toMatchObject({
        code: "global.session.locked",
      });
    } finally {
      context.destroy();
    }
  });
});
