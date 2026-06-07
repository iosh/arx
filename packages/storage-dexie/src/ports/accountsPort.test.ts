import "fake-indexeddb/auto";

import type { AccountRecord } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDexieStorage } from "../createDexieStorage.js";

const DB_NAME = "arx-accounts-port-test";
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

describe("DexieAccountsPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const storage = createTestStorage();
    const port = storage.ports.accounts;

    const record = {
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      namespace: "eip155",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
      alias: "A",
    } satisfies AccountRecord;

    await port.upsert(record);
    const loaded = await port.get(record.accountKey);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.accounts;

    const a = {
      accountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      namespace: "eip155",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
    } satisfies AccountRecord;

    const b = {
      accountKey: "eip155:cccccccccccccccccccccccccccccccccccccccc",
      namespace: "eip155",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 2000,
      hidden: true,
    } satisfies AccountRecord;

    await port.upsert(a);
    await port.upsert(b);

    const list = await port.list();
    expect(list.map((r) => r.accountKey).sort()).toEqual([a.accountKey, b.accountKey].sort());
  });

  it("remove() deletes by accountKey; removeByKeyringId() deletes all accounts for a keyring", async () => {
    const storage = createTestStorage();
    const port = storage.ports.accounts;

    const keyringA = "11111111-1111-4111-8111-111111111111";
    const keyringB = "22222222-2222-4222-8222-222222222222";

    const a1 = {
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      namespace: "eip155",
      keyringId: keyringA,
      createdAt: 1000,
    } satisfies AccountRecord;
    const a2 = {
      accountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      namespace: "eip155",
      keyringId: keyringA,
      createdAt: 2000,
    } satisfies AccountRecord;
    const b1 = {
      accountKey: "eip155:cccccccccccccccccccccccccccccccccccccccc",
      namespace: "eip155",
      keyringId: keyringB,
      createdAt: 3000,
    } satisfies AccountRecord;

    await port.upsert(a1);
    await port.upsert(a2);
    await port.upsert(b1);

    await port.remove(a1.accountKey);
    expect(await port.get(a1.accountKey)).toBeNull();

    await port.removeByKeyringId(keyringA);
    expect(await port.get(a2.accountKey)).toBeNull();
    expect(await port.get(b1.accountKey)).toEqual(b1);
  });
});
