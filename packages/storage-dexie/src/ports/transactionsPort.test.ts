import "fake-indexeddb/auto";

import { TransactionRecordSchema } from "@arx/core/db";
import { DOMAIN_SCHEMA_VERSION } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArxStorageDatabase } from "../db.js";
import { DexieTransactionsPort } from "./transactionsPort.js";

const DB_NAME = "arx-transactions-port-test";
let db: ArxStorageDatabase | null = null;

const openDb = async () => {
  db = new Dexie(DB_NAME) as unknown as ArxStorageDatabase;

  db.version(DOMAIN_SCHEMA_VERSION).stores({
    transactions: "&id, status, chainRef, hash, createdAt, updatedAt, [chainRef+createdAt], [status+createdAt]",
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
    originalWarn(...(args as any[]));
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

describe("DexieTransactionsPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const db = await openDb();
    const port = new DexieTransactionsPort(db);

    const record = TransactionRecordSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "pending",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1000,
      updatedAt: 1000,
    });

    await port.upsert(record);

    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns newest-first and respects filters + beforeCreatedAt", async () => {
    const db = await openDb();
    const port = new DexieTransactionsPort(db);

    const r1 = TransactionRecordSchema.parse({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "pending",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1000,
      updatedAt: 1000,
    });

    const r2 = TransactionRecordSchema.parse({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "approved",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 2000,
      updatedAt: 2000,
    });

    const r3 = TransactionRecordSchema.parse({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "approved",
      request: { namespace: "eip155", chainRef: "eip155:10", payload: { chainId: "0xa" } },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 3000,
      updatedAt: 3000,
    });

    await port.upsert(r1);
    await port.upsert(r2);
    await port.upsert(r3);

    const byChain = await port.list({ chainRef: "eip155:1" });
    expect(byChain.map((r) => r.id)).toEqual([r2.id, r1.id]);

    const byStatus = await port.list({ status: "approved" });
    expect(byStatus.map((r) => r.id)).toEqual([r3.id, r2.id]);

    const before = await port.list({ chainRef: "eip155:1", beforeCreatedAt: 2000 });
    expect(before.map((r) => r.id)).toEqual([r1.id]);
  });

  it("findByChainRefAndHash() finds the record by (chainRef, hash)", async () => {
    const db = await openDb();
    const port = new DexieTransactionsPort(db);

    const r = TransactionRecordSchema.parse({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
      hash: "txid-1",
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1000,
      updatedAt: 2000,
    });

    await port.upsert(r);

    const found = await port.findByChainRefAndHash({ chainRef: "eip155:1", hash: "txid-1" });
    expect(found?.id).toBe(r.id);

    const miss = await port.findByChainRefAndHash({ chainRef: "eip155:10", hash: "txid-1" });
    expect(miss).toBeNull();
  });

  it("updateIfStatus() updates only when expectedStatus matches", async () => {
    const db = await openDb();
    const port = new DexieTransactionsPort(db);

    const r = TransactionRecordSchema.parse({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "pending",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1000,
      updatedAt: 1000,
    });

    await port.upsert(r);

    const wrong = await port.updateIfStatus({
      id: r.id,
      expectedStatus: "approved",
      next: TransactionRecordSchema.parse({ ...r, status: "approved", updatedAt: 2000 }),
    });
    expect(wrong).toBe(false);

    const ok = await port.updateIfStatus({
      id: r.id,
      expectedStatus: "pending",
      next: TransactionRecordSchema.parse({ ...r, status: "approved", updatedAt: 2000 }),
    });
    expect(ok).toBe(true);

    const loaded = await port.get(r.id);
    expect(loaded?.status).toBe("approved");
    expect(loaded?.updatedAt).toBe(2000);
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("transactions").put({
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
    });

    const port = new DexieTransactionsPort(db);

    const loaded = await port.get("11111111-1111-4111-8111-111111111111");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid transaction record, dropping"),
      expect.anything(),
    );

    const after = await db.table("transactions").get("11111111-1111-4111-8111-111111111111");
    expect(after).toBeUndefined();
  });
});
