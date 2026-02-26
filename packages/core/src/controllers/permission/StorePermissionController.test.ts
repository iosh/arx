import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { createPermissionsService } from "../../services/store/permissions/PermissionsService.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { PermissionsService } from "../../services/store/permissions/types.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../storage/records.js";
import { StorePermissionController } from "./StorePermissionController.js";
import { PERMISSION_TOPICS } from "./topics.js";
import { PermissionCapabilities } from "./types.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";

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
  it("grant() requires chainRef", async () => {
    const { port } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const controller = new StorePermissionController({
      messenger,
      capabilityResolver: () => undefined,
      service,
    });

    await controller.whenReady();
    await expect(controller.grant(ORIGIN, PermissionCapabilities.Basic)).rejects.toThrow(/chainRef/i);
  });

  it("grant() writes to the store and publishes originChanged", async () => {
    const { port, store } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const controller = new StorePermissionController({
      messenger,
      capabilityResolver: () => undefined,
      service,
    });

    const originEvents: unknown[] = [];
    controller.onOriginPermissionsChanged((payload) => {
      originEvents.push(payload);
    });

    await controller.whenReady();
    await controller.grant(ORIGIN, PermissionCapabilities.Sign, { chainRef: CHAIN_REF });

    expect(store.size).toBe(1);

    const state = controller.getState();
    expect(state.origins[ORIGIN]?.eip155?.chains[CHAIN_REF]?.capabilities).toEqual([PermissionCapabilities.Sign]);
    expect(originEvents.length).toBeGreaterThan(0);
  });

  it("isConnected() requires non-empty accounts for eip155", async () => {
    const { port } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const controller = new StorePermissionController({
      messenger,
      capabilityResolver: () => undefined,
      service,
    });

    await controller.whenReady();
    expect(controller.isConnected(ORIGIN, { namespace: "eip155", chainRef: CHAIN_REF })).toBe(false);

    await controller.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: CHAIN_REF,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    expect(controller.isConnected(ORIGIN, { namespace: "eip155", chainRef: CHAIN_REF })).toBe(true);
  });

  it("isConnected() treats Accounts capability without accounts as not connected (dirty store defense)", async () => {
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const dirtyRecord = {
      origin: ORIGIN,
      namespace: "eip155",
      grants: [{ capability: PermissionCapabilities.Accounts, chainRefs: [CHAIN_REF] }],
      // Intentionally omit accountIds (this can happen if older versions wrote incomplete rows).
      updatedAt: 1000,
    } as unknown as PermissionRecord;

    const service = {
      subscribeChanged() {
        return () => {};
      },
      async get() {
        return null;
      },
      async listAll() {
        return [dirtyRecord];
      },
      async listByOrigin() {
        return [dirtyRecord];
      },
      async upsert() {
        return dirtyRecord;
      },
      async remove() {},
      async clearOrigin() {},
    } as unknown as PermissionsService;

    const controller = new StorePermissionController({
      messenger,
      capabilityResolver: () => undefined,
      service,
    });

    await controller.whenReady();
    expect(controller.isConnected(ORIGIN, { namespace: "eip155", chainRef: CHAIN_REF })).toBe(false);
  });
});
