import "fake-indexeddb/auto";

import { PermissionCapabilities } from "@arx/core";
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
    permissions: "[origin+namespace], origin",
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
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(record);
    expect(await port.get({ origin: record.origin, namespace: record.namespace })).toEqual(record);
  });

  it("get() returns the matching record (origin+namespace)", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const record = PermissionRecordSchema.parse({
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [
        { capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] },
        { capability: PermissionCapabilities.Sign, chainRefs: ["eip155:1"] },
      ],
      updatedAt: 1000,
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
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const a1 = PermissionRecordSchema.parse({
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
      updatedAt: 1000,
    });

    const b1 = PermissionRecordSchema.parse({
      origin: "https://other.example",
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(a1);
    await port.upsert(b1);

    const list = await port.listByOrigin("https://dapp.example");
    expect(list.map((r) => r.namespace)).toEqual([a1.namespace]);
  });

  it("clearOrigin() deletes only that origin", async () => {
    const db = await openDb();
    const port = new DexiePermissionsPort(db);

    const a1 = PermissionRecordSchema.parse({
      origin: "https://dapp.example",
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
      updatedAt: 1000,
    });

    const b1 = PermissionRecordSchema.parse({
      origin: "https://other.example",
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
      updatedAt: 1000,
    });

    await port.upsert(a1);
    await port.upsert(b1);

    await port.clearOrigin("https://dapp.example");

    expect(await port.listByOrigin("https://dapp.example")).toEqual([]);
    expect((await port.listByOrigin("https://other.example")).map((r) => r.namespace)).toEqual([b1.namespace]);
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("permissions").put({
      origin: "https://dapp.example",
      namespace: "eip155",
      // missing required fields on purpose (grants/updatedAt)
    });

    const port = new DexiePermissionsPort(db);

    const loaded = await port.get({ origin: "https://dapp.example", namespace: "eip155" });
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid permission record, dropping"),
      expect.anything(),
    );

    const after = await db.table("permissions").get(["https://dapp.example", "eip155"]);
    expect(after).toBeUndefined();
  });
});
