import "fake-indexeddb/auto";

import { KeyringMetaRecordSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDexieStorage } from "../createDexieStorage.js";
import { __closeSharedDatabaseForTests } from "../sharedDb.js";

const DB_NAME = "arx-keyring-metas-port-test";

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

describe("DexieKeyringMetasPort", () => {
  it("upsert() + get() roundtrip", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.keyringMetas;

    const record = KeyringMetaRecordSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "hd",
      alias: "Main",
      needsBackup: true,
      nextDerivationIndex: 3,
      createdAt: 1000,
    });

    await port.upsert(record);
    const loaded = await port.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.keyringMetas;

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
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const port = storage.ports.keyringMetas;

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
    const storage = createDexieStorage({ databaseName: DB_NAME });
    await storage.__debug.ctx.ready;

    await storage.__debug.db.table("keyringMetas").put({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      type: "hd",
      // missing createdAt on purpose
    } as unknown as Record<string, unknown>);

    const loaded = await storage.ports.keyringMetas.get("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(loaded).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid keyring meta record, dropping"),
      expect.anything(),
    );

    const after = await storage.__debug.db.table("keyringMetas").get("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(after).toBeUndefined();
  });
});
