import "fake-indexeddb/auto";

import { type TransactionRecord, TransactionRecordSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDexieStorage } from "../createDexieStorage.js";
import { __closeSharedDatabaseForTests } from "../sharedDb.js";

const DB_NAME = "arx-transactions-port-test";

const originalWarn = console.warn.bind(console);
let warnSpy: ReturnType<typeof vi.spyOn>;

const createRecord = (overrides: Partial<TransactionRecord> & { id: string }) =>
  TransactionRecordSchema.parse({
    id: overrides.id,
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "broadcast",
    submitted: {
      hash: "0x1111",
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    },
    locator: { format: "eip155.tx_hash", value: "0x1111" },
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  });

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

describe("DexieTransactionsPort", () => {
  it("create() + get() roundtrip", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.transactions;

    const record = createRecord({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      locator: { format: "eip155.tx_hash", value: "0x1111" },
      submitted: {
        hash: "0x1111",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    await port.create(record);

    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns newest-first and respects filters + before cursor", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.transactions;

    const r1 = createRecord({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      locator: { format: "eip155.tx_hash", value: "0x2222" },
      submitted: {
        hash: "0x2222",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      createdAt: 1000,
      updatedAt: 1000,
    });

    const r2 = createRecord({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "confirmed",
      locator: { format: "eip155.tx_hash", value: "0x3333" },
      submitted: {
        hash: "0x3333",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x8",
      },
      createdAt: 2000,
      updatedAt: 2000,
    });

    const r3 = createRecord({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      chainRef: "eip155:10",
      status: "confirmed",
      locator: { format: "eip155.tx_hash", value: "0x4444" },
      submitted: {
        hash: "0x4444",
        chainId: "0xa",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x9",
      },
      createdAt: 3000,
      updatedAt: 3000,
    });

    await port.create(r1);
    await port.create(r2);
    await port.create(r3);

    const byChain = await port.list({ chainRef: "eip155:1" });
    expect(byChain.map((r) => r.id)).toEqual([r2.id, r1.id]);

    const byStatus = await port.list({ status: "confirmed" });
    expect(byStatus.map((r) => r.id)).toEqual([r3.id, r2.id]);

    const before = await port.list({
      chainRef: "eip155:1",
      before: { createdAt: 2000, id: r2.id },
    });
    expect(before.map((r) => r.id)).toEqual([r1.id]);
  });

  it("list() paginates stably across rows that share createdAt", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.transactions;

    const r1 = createRecord({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      locator: { format: "eip155.tx_hash", value: "0x5555" },
      submitted: {
        hash: "0x5555",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      createdAt: 3000,
      updatedAt: 3000,
    });
    const r2 = createRecord({
      ...r1,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const r3 = createRecord({
      ...r1,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    await port.create(r1);
    await port.create(r2);
    await port.create(r3);

    const firstPage = await port.list({ status: "broadcast", limit: 2 });
    expect(firstPage.map((record) => record.id)).toEqual([r3.id, r2.id]);
    const cursor = firstPage[1];
    expect(cursor).toBeDefined();

    const secondPage = await port.list({
      status: "broadcast",
      limit: 2,
      before: { createdAt: cursor.createdAt, id: cursor.id },
    });
    expect(secondPage.map((record) => record.id)).toEqual([r1.id]);
  });

  it("findByChainRefAndLocator() finds the record by (chainRef, locator)", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.transactions;

    const record = createRecord({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      locator: { format: "eip155.tx_hash", value: "txid-1" },
      submitted: {
        hash: "txid-1",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      createdAt: 1000,
      updatedAt: 2000,
    });

    await port.create(record);

    const found = await port.findByChainRefAndLocator({
      chainRef: "eip155:1",
      locator: { format: "eip155.tx_hash", value: "txid-1" },
    });
    expect(found?.id).toBe(record.id);

    const miss = await port.findByChainRefAndLocator({
      chainRef: "eip155:10",
      locator: { format: "eip155.tx_hash", value: "txid-1" },
    });
    expect(miss).toBeNull();
  });

  it("updateIfStatus() updates only when expectedStatus matches", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.transactions;

    const record = createRecord({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      locator: { format: "eip155.tx_hash", value: "0x6666" },
      submitted: {
        hash: "0x6666",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    await port.create(record);

    const wrong = await port.updateIfStatus({
      id: record.id,
      expectedStatus: "confirmed",
      next: TransactionRecordSchema.parse({ ...record, status: "confirmed", updatedAt: 2000 }),
    });
    expect(wrong).toBe(false);

    const ok = await port.updateIfStatus({
      id: record.id,
      expectedStatus: "broadcast",
      next: TransactionRecordSchema.parse({ ...record, status: "confirmed", updatedAt: 2000 }),
    });
    expect(ok).toBe(true);

    const loaded = await port.get(record.id);
    expect(loaded?.status).toBe("confirmed");
    expect(loaded?.updatedAt).toBe(2000);
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    await storage.__debug.ctx.ready;

    await storage.__debug.db.table("transactions").put({
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
    } as unknown as Record<string, unknown>);

    const loaded = await storage.ports.transactions.get("11111111-1111-4111-8111-111111111111");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid transaction record, dropping"),
      expect.anything(),
    );

    const after = await storage.__debug.db.table("transactions").get("11111111-1111-4111-8111-111111111111");
    expect(after).toBeUndefined();
  });
});
