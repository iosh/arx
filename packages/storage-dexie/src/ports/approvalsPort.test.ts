import "fake-indexeddb/auto";

import { ApprovalRecordSchema } from "@arx/core/db";
import { DOMAIN_SCHEMA_VERSION } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArxStorageDatabase } from "../db.js";
import { DexieApprovalsPort } from "./approvalsPort.js";

const DB_NAME = "arx-approvals-port-test";
let db: ArxStorageDatabase | null = null;
const openDb = async () => {
  db = new Dexie(DB_NAME) as unknown as ArxStorageDatabase;

  db.version(DOMAIN_SCHEMA_VERSION).stores({
    approvals: "&id, status, type, origin, createdAt",
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

describe("DexieApprovalsPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const db = await openDb();
    const port = new DexieApprovalsPort(db);

    const record = ApprovalRecordSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "wallet_requestAccounts",
      status: "pending",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
      createdAt: 1000,
    });

    await port.upsert(record);

    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("listPending() returns only pending approvals", async () => {
    const db = await openDb();
    const port = new DexieApprovalsPort(db);

    const pending = ApprovalRecordSchema.parse({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "wallet_requestAccounts",
      status: "pending",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
      createdAt: 1000,
    });

    const expired = ApprovalRecordSchema.parse({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      type: "wallet_requestAccounts",
      status: "expired",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
      createdAt: 1000,
      finalizedAt: 1500,
      finalStatusReason: "session_lost",
    });

    await port.upsert(pending);
    await port.upsert(expired);

    const list = await port.listPending();
    expect(list.map((r) => r.id)).toEqual([pending.id]);
  });

  it("drops invalid rows on read (warn + delete)", async () => {
    const db = await openDb();

    await db.table("approvals").put({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      // missing required fields on purpose
      status: "pending",
    });

    const port = new DexieApprovalsPort(db);

    const loaded = await port.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid approval record, dropping"),
      expect.anything(),
    );

    const after = await db.table("approvals").get("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(after).toBeUndefined();
  });
});
