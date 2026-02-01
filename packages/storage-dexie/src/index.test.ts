import "fake-indexeddb/auto";

import { NetworkRpcPreferenceRecordSchema } from "@arx/core/db";
import { DOMAIN_SCHEMA_VERSION, VAULT_META_SNAPSHOT_VERSION, VaultMetaSnapshotSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDexieNetworkRpcPort, createDexieVaultMetaPort } from "./ports/factories.js";

const DB_NAME = "arx-storage-index-test";

const originalWarn = console.warn.bind(console);
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("[storage-dexie]")) return;
    originalWarn(...(args as any[]));
  });
});

afterEach(async () => {
  await Dexie.delete(DB_NAME);
  warnSpy.mockRestore();
});

describe("@arx/storage-dexie ports", () => {
  it("NetworkRpcPort roundtrips", async () => {
    const port = createDexieNetworkRpcPort({ databaseName: DB_NAME });

    const record = NetworkRpcPreferenceRecordSchema.parse({
      chainRef: "eip155:1",
      activeIndex: 0,
      strategy: { id: "round-robin" },
      updatedAt: 1_000,
    });

    await port.upsert(record);
    expect(await port.get(record.chainRef)).toEqual(record);
  });

  it("VaultMetaPort drops invalid vault meta on load", async () => {
    const port = createDexieVaultMetaPort({ databaseName: DB_NAME });

    const raw = new Dexie(DB_NAME);
    raw.version(DOMAIN_SCHEMA_VERSION).stores({
      vaultMeta: "&id",
    });
    await raw.open();
    await raw.table("vaultMeta").put({ id: "vault-meta", version: 1, updatedAt: 0, payload: { bad: true } });
    await raw.close();

    const loaded = await port.loadVaultMeta();
    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid vault meta detected"),
      expect.anything(),
    );
  });

  it("VaultMetaPort roundtrips", async () => {
    const port = createDexieVaultMetaPort({ databaseName: DB_NAME });
    const snapshot = VaultMetaSnapshotSchema.parse({
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        ciphertext: null,
        autoLockDuration: 900_000,
        initializedAt: 1_000,
      },
    });

    await port.saveVaultMeta(snapshot);
    expect(await port.loadVaultMeta()).toEqual(snapshot);
  });
});
