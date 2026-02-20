import { describe, expect, it } from "vitest";
import { PermissionScopes } from "../../controllers/permission/types.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../db/records.js";
import { createPermissionsService } from "./PermissionsService.js";
import type { PermissionsPort } from "./port.js";

const ORIGIN = "https://dapp.example";
const NAMESPACE = "eip155";

const createInMemoryPort = (seed: PermissionRecord[] = []) => {
  const store = new Map<string, PermissionRecord>(seed.map((r) => [r.id, r]));
  const writes: PermissionRecord[] = [];

  const port: PermissionsPort = {
    async get(id) {
      return store.get(id) ?? null;
    },

    async listAll() {
      return [...store.values()];
    },

    async getByOrigin({ origin, namespace }) {
      for (const record of store.values()) {
        if (record.origin === origin && record.namespace === namespace) {
          return record;
        }
      }
      return null;
    },

    async listByOrigin(origin) {
      return [...store.values()].filter((r) => r.origin === origin);
    },

    async upsert(record) {
      const checked = PermissionRecordSchema.parse(record);
      store.set(checked.id, checked);
      writes.push(checked);
    },

    async remove(id) {
      store.delete(id);
    },

    async clearOrigin(origin) {
      for (const [id, record] of store.entries()) {
        if (record.origin === origin) {
          store.delete(id);
        }
      }
    },
  };

  return { port, store, writes };
};

describe("PermissionsService", () => {
  it("upsert() reuses id for the same (origin, namespace) and emits changed once per write", async () => {
    const { port, store } = createInMemoryPort();
    let t = 1000;

    const service = createPermissionsService({ port, now: () => t });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    const id1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await service.upsert({
      id: id1,
      origin: ORIGIN,
      namespace: NAMESPACE,
      grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
    });

    t = 2000;
    const id2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await service.upsert({
      id: id2,
      origin: ORIGIN,
      namespace: NAMESPACE,
      grants: [
        { scope: PermissionScopes.Basic, chains: ["eip155:1"] },
        { scope: PermissionScopes.Sign, chains: ["eip155:1"] },
      ],
    });

    expect(changed).toBe(2);
    expect(store.size).toBe(1);

    const current = await service.getByOrigin({ origin: ORIGIN, namespace: NAMESPACE });
    expect(current).not.toBeNull();
    if (!current) throw new Error("Expected permission record to exist");
    expect(current.id).toBe(id1); // id reused
    expect(current.grants.map((g) => g.scope)).toEqual([PermissionScopes.Basic, PermissionScopes.Sign]);
    expect(current.updatedAt).toBe(2000);
  });

  it("getByOrigin() returns null when missing", async () => {
    const { port } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });

    const missing = await service.getByOrigin({ origin: ORIGIN, namespace: NAMESPACE });
    expect(missing).toBeNull();
  });

  it("clearOrigin() removes all records for the origin and emits changed", async () => {
    const seed = [
      PermissionRecordSchema.parse({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        origin: ORIGIN,
        namespace: NAMESPACE,
        grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
        updatedAt: 1,
      }),
      PermissionRecordSchema.parse({
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        origin: "https://other.example",
        namespace: NAMESPACE,
        grants: [{ scope: PermissionScopes.Basic, chains: ["eip155:1"] }],
        updatedAt: 1,
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const service = createPermissionsService({ port, now: () => 1000 });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    await service.clearOrigin(ORIGIN);

    expect(changed).toBe(1);
    expect(await service.listByOrigin(ORIGIN)).toEqual([]);
    expect((await service.listByOrigin("https://other.example")).length).toBe(1);
  });
});
