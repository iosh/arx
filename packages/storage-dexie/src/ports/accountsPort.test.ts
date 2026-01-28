import "fake-indexeddb/auto";

import { AccountRecordSchema } from "@arx/core/db";
import { DOMAIN_SCHEMA_VERSION } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DexieAccountsPort } from "./accountsPort.js";
import type { ArxStorageDatabase } from "../db.js";

const DB_NAME = "arx-accounts-port-test";
let db: ArxStorageDatabase | null = null;

const openDb = async () => {
  db = new Dexie(DB_NAME) as unknown as ArxStorageDatabase;

  db.version(DOMAIN_SCHEMA_VERSION).stores({
    accounts: "&accountId, namespace, keyringId",
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

describe("DexieAccountsPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const db = await openDb();
    const port = new DexieAccountsPort(db);

    const record = AccountRecordSchema.parse({
      accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      namespace: "eip155",
      payloadHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
      alias: "A",
    });

    await port.upsert(record);

    const loaded = await port.get(record.accountId);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const db = await openDb();
    const port = new DexieAccountsPort(db);

    const a = AccountRecordSchema.parse({
      accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      namespace: "eip155",
      payloadHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
    });

    const b = AccountRecordSchema.parse({
      accountId: "eip155:cccccccccccccccccccccccccccccccccccccccc",
      namespace: "eip155",
      payloadHex: "cccccccccccccccccccccccccccccccccccccccc",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 2000,
      hidden: true,
    });

    await port.upsert(a);
    await port.upsert(b);

    const list = await port.list();
    expect(list.map((r) => r.accountId).sort()).toEqual([a.accountId, b.accountId].sort());
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("accounts").put({
      accountId: "eip155:dddddddddddddddddddddddddddddddddddddddd",
      // missing required fields on purpose
    });

    const port = new DexieAccountsPort(db);

    const loaded = await port.get("eip155:dddddddddddddddddddddddddddddddddddddddd");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid account record, dropping"),
      expect.anything(),
    );

    const after = await db.table("accounts").get("eip155:dddddddddddddddddddddddddddddddddddddddd");
    expect(after).toBeUndefined();
  });
});
