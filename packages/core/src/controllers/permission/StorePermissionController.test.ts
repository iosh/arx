import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { createPermissionsService } from "../../services/store/permissions/PermissionsService.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../storage/records.js";
import { StorePermissionController } from "./StorePermissionController.js";
import { PERMISSION_TOPICS } from "./topics.js";

const ORIGIN = "https://dapp.example";
const NAMESPACE = "eip155";
const MAINNET = "eip155:1";
const POLYGON = "eip155:137";
const ACCOUNT_ID = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ACCOUNT_ID = "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const createRecord = (chains: Array<{ chainRef: string; accountKeys: string[] }>, updatedAt: number) =>
  PermissionRecordSchema.parse({
    origin: ORIGIN,
    namespace: NAMESPACE,
    chains,
    updatedAt,
  });

const createInMemoryPort = (seed: PermissionRecord[] = []) => {
  const toKey = (record: PermissionRecord) => `${record.origin}::${record.namespace}`;
  const store = new Map<string, PermissionRecord>(seed.map((record) => [toKey(record), record]));

  const port: PermissionsPort = {
    async listAll() {
      return [...store.values()];
    },
    async get({ origin, namespace }) {
      return store.get(`${origin}::${namespace}`) ?? null;
    },
    async listByOrigin(origin) {
      return [...store.values()].filter((record) => record.origin === origin);
    },
    async upsert(record) {
      const checked = PermissionRecordSchema.parse(record);
      store.set(toKey(checked), checked);
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

  return { port, store };
};

describe("StorePermissionController", () => {
  it("upsertAuthorization() writes one authorization record and publishes originChanged", async () => {
    const { port, store } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const controller = new StorePermissionController({
      messenger,
      service,
    });

    const originEvents: unknown[] = [];
    controller.onOriginChanged((payload) => {
      originEvents.push(payload);
    });

    await controller.whenReady();
    await controller.upsertAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chains: [{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }],
    });

    expect(store.size).toBe(1);
    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [MAINNET]: {
          accountKeys: [ACCOUNT_ID],
        },
      },
    });
    expect(originEvents.length).toBeGreaterThan(0);
  });

  it("setChainAccountKeys() updates only the targeted chain authorization", async () => {
    const seed = [createRecord([{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }], 1000)];

    const { port } = createInMemoryPort(seed);
    const service = createPermissionsService({ port, now: () => 2000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new StorePermissionController({ messenger, service });

    await controller.whenReady();
    await controller.setChainAccountKeys(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: MAINNET,
      accountKeys: [OTHER_ACCOUNT_ID],
    });

    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [MAINNET]: {
          accountKeys: [OTHER_ACCOUNT_ID],
        },
      },
    });
  });

  it("addPermittedChains() merges chains into the existing authorization", async () => {
    const seed = [createRecord([{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }], 1000)];

    const { port } = createInMemoryPort(seed);
    const service = createPermissionsService({ port, now: () => 2000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new StorePermissionController({ messenger, service });

    await controller.whenReady();
    await controller.addPermittedChains(ORIGIN, {
      namespace: NAMESPACE,
      chainRefs: [POLYGON],
    });

    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [MAINNET]: {
          accountKeys: [ACCOUNT_ID],
        },
        [POLYGON]: {
          accountKeys: [],
        },
      },
    });
  });

  it("revokePermittedChains() deletes the authorization when the last chain is removed", async () => {
    const seed = [createRecord([{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }], 1000)];

    const { port, store } = createInMemoryPort(seed);
    const service = createPermissionsService({ port, now: () => 2000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new StorePermissionController({ messenger, service });

    await controller.whenReady();
    await controller.revokePermittedChains(ORIGIN, {
      namespace: NAMESPACE,
      chainRefs: [MAINNET],
    });

    expect(store.size).toBe(0);
    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toBeNull();
  });
});
