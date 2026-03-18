import "fake-indexeddb/auto";

import { PermissionRecordSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDexieStorage } from "../createDexieStorage.js";
import { __closeSharedDatabaseForTests } from "../sharedDb.js";

const DB_NAME = "arx-permissions-port-test";

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

describe("DexiePermissionsPort", () => {
  const createRecord = (args: {
    origin?: string;
    chains: Array<{ chainRef: string; accountKeys: string[] }>;
    updatedAt?: number;
  }) =>
    PermissionRecordSchema.parse({
      origin: args.origin ?? "https://dapp.example",
      namespace: "eip155",
      chains: args.chains,
      updatedAt: args.updatedAt ?? 1000,
    });

  it("upsert() + get() roundtrip", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.permissions;

    const record = createRecord({
      chains: [{ chainRef: "eip155:1", accountKeys: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
    });

    await port.upsert(record);
    expect(await port.get({ origin: record.origin, namespace: record.namespace })).toEqual(record);
  });

  it("get() returns the matching record (origin+namespace)", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
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
    const storage = createDexieStorage({ databaseName: DB_NAME });
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
    const storage = createDexieStorage({ databaseName: DB_NAME });
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

  it("drops invalid rows on read (warn + delete)", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    await storage.__debug.ctx.ready;

    await storage.__debug.db.table("permissions").put({
      origin: "https://dapp.example",
      namespace: "eip155",
      // missing required fields on purpose (chains/updatedAt)
    } as unknown as Record<string, unknown>);

    const loaded = await storage.ports.permissions.get({ origin: "https://dapp.example", namespace: "eip155" });
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid permission record, dropping"),
      expect.anything(),
    );

    const after = await storage.__debug.db.table("permissions").get(["https://dapp.example", "eip155"]);
    expect(after).toBeUndefined();
  });
});
