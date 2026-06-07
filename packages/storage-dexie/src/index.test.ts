import "fake-indexeddb/auto";

import { type NetworkSelectionRecord, VAULT_META_SNAPSHOT_VERSION, type VaultMetaSnapshot } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDexieStorage } from "./createDexieStorage.js";

const DB_NAME = "arx-storage-index-test";
const storages: Array<ReturnType<typeof createDexieStorage>> = [];

const createTestStorage = (): ReturnType<typeof createDexieStorage> => {
  const storage = createDexieStorage({ databaseName: DB_NAME });
  storages.push(storage);
  return storage;
};

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Dexie.delete(DB_NAME);
});

describe("@arx/storage-dexie", () => {
  it("NetworkSelectionPort roundtrips", async () => {
    const storage = createTestStorage();
    const port = storage.ports.networkSelection;

    const record = {
      id: "network-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: "eip155:1" },
      updatedAt: 1_000,
    } satisfies NetworkSelectionRecord;

    await port.put(record);
    expect(await port.get()).toEqual(record);
  });

  it("VaultMetaPort roundtrips", async () => {
    const storage = createTestStorage();
    const port = storage.ports.vaultMeta;

    const snapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        envelope: null,
        autoLockDurationMs: 900_000,
        initializedAt: 1_000,
      },
    } satisfies VaultMetaSnapshot;

    await port.saveVaultMeta(snapshot);
    expect(await port.loadVaultMeta()).toEqual(snapshot);
  });
});
