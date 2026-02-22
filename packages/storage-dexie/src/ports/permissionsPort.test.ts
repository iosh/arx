import "fake-indexeddb/auto";

import { PermissionScopes } from "@arx/core";
import { DOMAIN_SCHEMA_VERSION, PermissionRecordSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArxStorageDatabase } from "../db.js";
import { DexiePermissionsPort } from "./permissionsPort.js";

const DB_NAME = "arx-permissions-port-test";
let db: ArxStorageDatabase | null = null;

const openDb = async () => {
  db = new Dexie(DB_NAME) as unknown as ArxStorageDatabase;

  db.version(DOMAIN_SCHEMA_VERSION).stores({
    permissions: "&id, origin, &[origin+namespace]",
  });

  await db.open();
  return db;
};

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
  if (db) {
    db.close();
    db = null;
  }
  await Dexie.delete(DB_NAME);
  warnSpy.mockRestore();
});

describe("DexiePermissionsPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const record = PermissionRecordSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(record);
    expect(await port.get(record.id)).toEqual(record);
  });

  it("getByOrigin() returns the matching record (origin+namespace)", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const record = PermissionRecordSchema.parse({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [
        { scope: PermissionScopes.Basic, chains: ["eip155:1"] },
        { scope: PermissionScopes.Sign, chains: ["eip155:1"] },
      ],
      updatedAt: 1000,
    });

    await port.upsert(record);

    const hit = await port.getByOrigin({
      origin: "https://dapp.example",
      namespace: "eip155",
    });

    expect(hit).toEqual(record);

    const miss = await port.getByOrigin({
      origin: "https://dapp.example",
      namespace: "other",
    });

    expect(miss).toBeNull();
  });

  it("listByOrigin() returns only records for that origin", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const a1 = PermissionRecordSchema.parse({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
      updatedAt: 1000,
    });

    const b1 = PermissionRecordSchema.parse({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      origin: "https://other.example",
      namespace: "eip155",
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(a1);
    await port.upsert(b1);

    const list = await port.listByOrigin("https://dapp.example");
    expect(list.map((r) => r.id)).toEqual([a1.id]);
  });

  it("clearOrigin() deletes only that origin", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const a1 = PermissionRecordSchema.parse({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
      updatedAt: 1000,
    });

    const b1 = PermissionRecordSchema.parse({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      origin: "https://other.example",
      namespace: "eip155",
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(a1);
    await port.upsert(b1);

    await port.clearOrigin("https://dapp.example");

    expect(await port.listByOrigin("https://dapp.example")).toEqual([]);
    expect((await port.listByOrigin("https://other.example")).map((r) => r.id)).toEqual([b1.id]);
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("permissions").put({
      id: "12121212-1212-4121-8121-121212121212",
      origin: "https://dapp.example",
      // missing required fields on purpose
    });

    const port = new DexiePermissionsPort(db);

    const loaded = await port.get("12121212-1212-4121-8121-121212121212");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid permission record, dropping"),
      expect.anything(),
    );

    const after = await db.table("permissions").get("12121212-1212-4121-8121-121212121212");
    expect(after).toBeUndefined();
  });
});
