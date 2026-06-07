import "fake-indexeddb/auto";

import type { KeyringMetaRecord } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDexieStorage } from "../createDexieStorage.js";

const DB_NAME = "arx-keyring-metas-port-test";
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

describe("DexieKeyringMetasPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const storage = createTestStorage();
    const port = storage.ports.keyringMetas;

    const record = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "hd",
      alias: "Main",
      needsBackup: true,
      nextDerivationIndex: 3,
      createdAt: 1000,
    } satisfies KeyringMetaRecord;

    await port.upsert(record);
    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.keyringMetas;

    const a = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "hd",
      createdAt: 1000,
    } satisfies KeyringMetaRecord;

    const b = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      type: "private-key",
      createdAt: 2000,
    } satisfies KeyringMetaRecord;

    await port.upsert(a);
    await port.upsert(b);

    const list = await port.list();
    expect(list.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("remove() deletes the record", async () => {
    const storage = createTestStorage();
    const port = storage.ports.keyringMetas;

    const record = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      type: "hd",
      createdAt: 1000,
    } satisfies KeyringMetaRecord;

    await port.upsert(record);
    await port.remove(record.id);

    expect(await port.get(record.id)).toBeNull();
  });
});
