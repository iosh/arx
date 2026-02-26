import { describe, expect, it } from "vitest";
import { PermissionCapabilities } from "../../../controllers/permission/types.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../../storage/records.js";
import { createPermissionsService } from "./PermissionsService.js";
import type { PermissionsPort } from "./port.js";

const ORIGIN = "https://dapp.example";
const NAMESPACE = "eip155";

const createInMemoryPort = (seed: PermissionRecord[] = []) => {
  const toKey = (record: PermissionRecord) => `${record.origin}::${record.namespace}`;
  const store = new Map<string, PermissionRecord>(seed.map((r) => [toKey(r), r]));
  const writes: PermissionRecord[] = [];

  const port: PermissionsPort = {
    async listAll() {
      return [...store.values()];
    },

    async get({ origin, namespace }) {
      return store.get(`${origin}::${namespace}`) ?? null;
    },

    async listByOrigin(origin) {
      return [...store.values()].filter((r) => r.origin === origin);
    },

    async upsert(record) {
      const checked = PermissionRecordSchema.parse(record);
      store.set(`${checked.origin}::${checked.namespace}`, checked);
      writes.push(checked);
    },

    async remove({ origin, namespace }) {
      store.delete(`${origin}::${namespace}`);
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
  it("upsert() overwrites the same (origin, namespace) and emits changed once per write", async () => {
    const { port, store } = createInMemoryPort();
    let t = 1000;

    const service = createPermissionsService({ port, now: () => t });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    await service.upsert({
      origin: ORIGIN,
      namespace: NAMESPACE,
      grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
    });

    t = 2000;
    await service.upsert({
      origin: ORIGIN,
      namespace: NAMESPACE,
      grants: [
        { capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] },
        { capability: PermissionCapabilities.Sign, chainRefs: ["eip155:1"] },
      ],
    });

    expect(changed).toBe(2);
    expect(store.size).toBe(1);

    const current = await service.get({ origin: ORIGIN, namespace: NAMESPACE });
    expect(current).not.toBeNull();
    if (!current) throw new Error("Expected permission record to exist");
    expect(current.grants.map((g) => g.capability)).toEqual([
      PermissionCapabilities.Basic,
      PermissionCapabilities.Sign,
    ]);
    expect(current.updatedAt).toBe(2000);
  });

  it("get() returns null when missing", async () => {
    const { port } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });

    const missing = await service.get({ origin: ORIGIN, namespace: NAMESPACE });
    expect(missing).toBeNull();
  });

  it("clearOrigin() removes all records for the origin and emits changed", async () => {
    const seed = [
      PermissionRecordSchema.parse({
        origin: ORIGIN,
        namespace: NAMESPACE,
        grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
        updatedAt: 1,
      }),
      PermissionRecordSchema.parse({
        origin: "https://other.example",
        namespace: NAMESPACE,
        grants: [{ capability: PermissionCapabilities.Basic, chainRefs: ["eip155:1"] }],
        updatedAt: 1,
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const service = createPermissionsService({ port, now: () => 1000 });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    await service.clearOrigin(ORIGIN);

    expect(changed).toBe(1);
    expect(await service.listByOrigin(ORIGIN)).toEqual([]);
    expect((await service.listByOrigin("https://other.example")).length).toBe(1);
  });
});
