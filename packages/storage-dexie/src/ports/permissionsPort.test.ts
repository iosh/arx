import "fake-indexeddb/auto";

import type { PermissionRecord } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { createDexieStorage } from "../createDexieStorage.js";

const DB_NAME = "arx-permissions-port-test";
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

describe("DexiePermissionsPort", () => {
  const createRecord = (args: { origin?: string; chains: Array<{ chainRef: string; accountKeys: string[] }> }) =>
    ({
      origin: args.origin ?? "https://dapp.example",
      namespace: "eip155",
      chainScopes: Object.fromEntries(args.chains.map((chain) => [chain.chainRef, chain.accountKeys])),
    }) satisfies PermissionRecord;

  it("upsert() + get() roundtrip", async () => {
    const storage = createTestStorage();
    const port = storage.ports.permissions;

    const record = createRecord({
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
    });

    await port.upsert(record);
    expect(await port.get({ origin: record.origin, namespace: record.namespace })).toEqual(record);
  });

  it("get() returns the matching record (origin+namespace)", async () => {
    const storage = createTestStorage();
    const port = storage.ports.permissions;

    const record = createRecord({
      chains: [
        { chainRef: "eip155:1", accountKeys: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
        { chainRef: "eip155:137", accountKeys: [] },
      ],
    });

    await port.upsert(record);

    const hit = await port.get({
      origin: "https://dapp.example",
      namespace: "eip155",
    });

    expect(hit).toEqual(record);

    const miss = await port.get({
      origin: "https://dapp.example",
      namespace: "other",
    });

    expect(miss).toBeNull();
  });

  it("listByOrigin() returns only records for that origin", async () => {
    const storage = createTestStorage();
    const port = storage.ports.permissions;

    const a1 = createRecord({
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
    });

    const b1 = createRecord({
      origin: "https://other.example",
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }],
    });

    await port.upsert(a1);
    await port.upsert(b1);

    const list = await port.listByOrigin("https://dapp.example");
    expect(list.map((r) => r.namespace)).toEqual([a1.namespace]);
  });

  it("clearOrigin() deletes only that origin", async () => {
    const storage = createTestStorage();
    const port = storage.ports.permissions;

    const a1 = createRecord({
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
    });

    const b1 = createRecord({
      origin: "https://other.example",
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }],
    });

    await port.upsert(a1);
    await port.upsert(b1);

    await port.clearOrigin("https://dapp.example");

    expect(await port.listByOrigin("https://dapp.example")).toEqual([]);
    expect((await port.listByOrigin("https://other.example")).map((r) => r.namespace)).toEqual([b1.namespace]);
  });
});
