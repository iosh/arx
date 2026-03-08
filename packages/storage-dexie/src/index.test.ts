import "fake-indexeddb/auto";

import {
  NetworkPreferencesRecordSchema,
  VAULT_META_SNAPSHOT_VERSION,
  VaultMetaSnapshotSchema,
} from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDexieStorage } from "./createDexieStorage.js";
import { __closeSharedDatabaseForTests } from "./sharedDb.js";

const DB_NAME = "arx-storage-index-test";

const originalWarn = console.warn.bind(console);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("[storage-dexie]")) return;
    originalWarn(...args);
  });
});

afterEach(async () => {
  __closeSharedDatabaseForTests(DB_NAME);
  await Dexie.delete(DB_NAME);
  warnSpy.mockRestore();
});

describe("@arx/storage-dexie", () => {
  it("NetworkPreferencesPort roundtrips", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.networkPreferences;

    const record = NetworkPreferencesRecordSchema.parse({
      id: "network-preferences",
      selectedChainRef: "eip155:1",
      activeChainByNamespace: { eip155: "eip155:1" },
      rpc: {
        "eip155:1": { activeIndex: 0, strategy: { id: "round-robin" } },
      },
      updatedAt: 1_000,
    });

    await port.put(record);
    expect(await port.get()).toEqual(record);
  });

  it("VaultMetaPort drops invalid vault meta on load", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.vaultMeta;

    await storage.__debug.ctx.ready;
    await storage.__debug.db.vaultMeta.put({ id: "vault-meta", version: 1, updatedAt: 0, payload: { bad: true } });

    const loaded = await port.loadVaultMeta();
    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid vault meta, dropping"),
      expect.anything(),
    );
  });

  it("VaultMetaPort roundtrips", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.vaultMeta;

    const snapshot = VaultMetaSnapshotSchema.parse({
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        envelope: null,
        autoLockDurationMs: 900_000,
        initializedAt: 1_000,
      },
    });

    await port.saveVaultMeta(snapshot);
    expect(await port.loadVaultMeta()).toEqual(snapshot);
  });
});
