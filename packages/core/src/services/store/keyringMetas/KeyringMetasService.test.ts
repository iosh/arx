import { describe, expect, it } from "vitest";
import { createMessenger } from "../../../messenger/index.js";
import type { KeyringMetaRecord } from "../../../storage/records.js";
import { createKeyringMetasService } from "./KeyringMetasService.js";
import type { KeyringMetasPort } from "./port.js";

const createInMemoryPort = (seed: KeyringMetaRecord[] = []) => {
  const store = new Map<string, KeyringMetaRecord>(seed.map((r) => [r.id, r]));
  const writes: Array<{ type: "upsert" | "remove"; id: string }> = [];

  const port: KeyringMetasPort = {
    async get(id) {
      return store.get(id) ?? null;
    },
    async list() {
      return [...store.values()];
    },
    async upsert(record) {
      store.set(record.id, record);
      writes.push({ type: "upsert", id: record.id });
    },
    async remove(id) {
      store.delete(id);
      writes.push({ type: "remove", id });
    },
  };

  return { port, store, writes };
};

const createService = (port: KeyringMetasPort) => createKeyringMetasService({ messenger: createMessenger(), port });

describe("KeyringMetasService", () => {
  it("upsert() and get() roundtrip and emit changed", async () => {
    const { port } = createInMemoryPort();
    const service = createService(port);

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const record = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "hd",
      alias: "Main",
      needsBackup: true,
      createdAt: 1000,
    } satisfies KeyringMetaRecord;

    await service.upsert(record);
    expect(changed).toBe(1);

    const loaded = await service.get(record.id);
    expect(loaded).toEqual(record);
  });

  it("list() returns all records", async () => {
    const seed: KeyringMetaRecord[] = [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "hd",
        createdAt: 1000,
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "private-key",
        createdAt: 2000,
      },
    ];

    const { port } = createInMemoryPort(seed);
    const service = createService(port);

    const list = await service.list();
    expect(list.length).toBe(2);
    expect(list.map((r) => r.id).sort()).toEqual(seed.map((r) => r.id).sort());
  });

  it("remove() deletes record and emits changed", async () => {
    const seed: KeyringMetaRecord[] = [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        type: "hd",
        createdAt: 1000,
      },
    ];

    const { port } = createInMemoryPort(seed);
    const service = createService(port);

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    await service.remove("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(changed).toBe(1);

    const loaded = await service.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(loaded).toBeNull();
  });
});
