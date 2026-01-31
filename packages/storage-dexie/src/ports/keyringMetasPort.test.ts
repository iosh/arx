import "fake-indexeddb/auto";

import { KeyringMetaRecordSchema } from "@arx/core/db";
import { DOMAIN_SCHEMA_VERSION } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArxStorageDatabase } from "../db.js";
import { DexieKeyringMetasPort } from "./keyringMetasPort.js";

const DB_NAME = "arx-keyring-metas-port-test";
let db: ArxStorageDatabase | null = null;

const openDb = async () => {
  db = new Dexie(DB_NAME) as unknown as ArxStorageDatabase;

  db.version(DOMAIN_SCHEMA_VERSION).stores({
    keyringMetas: "&id, type, createdAt",
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

describe("DexieKeyringMetasPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const db = await openDb();
    const port = new DexieKeyringMetasPort(db);

    const record = KeyringMetaRecordSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "hd",
      name: "Main",
      needsBackup: true,
      nextDerivationIndex: 3,
      createdAt: 1000,
    });

    await port.upsert(record);

    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const db = await openDb();
    const port = new DexieKeyringMetasPort(db);

    const a = KeyringMetaRecordSchema.parse({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "hd",
      createdAt: 1000,
    });

    const b = KeyringMetaRecordSchema.parse({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      type: "private-key",
      createdAt: 2000,
    });

    await port.upsert(a);
    await port.upsert(b);

    const list = await port.list();
    expect(list.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("remove() deletes the record", async () => {
    const db = await openDb();
    const port = new DexieKeyringMetasPort(db);

    const record = KeyringMetaRecordSchema.parse({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      type: "hd",
      createdAt: 1000,
    });

    await port.upsert(record);
    await port.remove(record.id);

    expect(await port.get(record.id)).toBeNull();
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("keyringMetas").put({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      type: "hd",
      // missing createdAt on purpose
    });

    const port = new DexieKeyringMetasPort(db);

    const loaded = await port.get("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid keyring meta record, dropping"),
      expect.anything(),
    );

    const after = await db.table("keyringMetas").get("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(after).toBeUndefined();
  });
});
