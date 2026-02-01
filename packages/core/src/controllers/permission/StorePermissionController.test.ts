import { describe, expect, it } from "vitest";
import { type PermissionRecord, PermissionRecordSchema } from "../../db/records.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { createPermissionsService } from "../../services/permissions/PermissionsService.js";
import type { PermissionsPort } from "../../services/permissions/port.js";
import { StorePermissionController } from "./StorePermissionController.js";
import type { PermissionMessengerTopics } from "./types.js";
import { PermissionScopes } from "./types.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";

const createInMemoryPort = (seed: PermissionRecord[] = []) => {
  const store = new Map<string, PermissionRecord>(seed.map((record) => [record.id, record]));

  const port: PermissionsPort = {
    async get(id) {
      return store.get(id) ?? null;
    },
    async listAll() {
      return [...store.values()];
    },
    async getByOrigin({ origin, namespace, chainRef }) {
      for (const record of store.values()) {
        if (record.origin !== origin) continue;
        if (record.namespace !== namespace) continue;
        if (record.chainRef !== chainRef) continue;
        return record;
      }
      return null;
    },
    async listByOrigin(origin) {
      return [...store.values()].filter((record) => record.origin === origin);
    },
    async upsert(record) {
      const checked = PermissionRecordSchema.parse(record);
      store.set(checked.id, checked);
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

  return { port, store };
};

describe("StorePermissionController", () => {
  it("grant() requires chainRef", async () => {
    const { port } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new ControllerMessenger<PermissionMessengerTopics>({});

    const controller = new StorePermissionController({
      messenger,
      scopeResolver: () => undefined,
      service,
    });

    await controller.whenReady();
    await expect(controller.grant(ORIGIN, PermissionScopes.Basic)).rejects.toThrow(/chainRef/i);
  });

  it("grant() writes to the store and publishes originChanged", async () => {
    const { port, store } = createInMemoryPort();
    const service = createPermissionsService({ port, now: () => 1000 });
    const messenger = new ControllerMessenger<PermissionMessengerTopics>({});

    const controller = new StorePermissionController({
      messenger,
      scopeResolver: () => undefined,
      service,
    });

    const originEvents: unknown[] = [];
    controller.onOriginPermissionsChanged((payload) => {
      originEvents.push(payload);
    });

    await controller.whenReady();
    await controller.grant(ORIGIN, PermissionScopes.Sign, { chainRef: CHAIN_REF });

    expect(store.size).toBe(1);

    const state = controller.getState();
    expect(state.origins[ORIGIN]?.eip155?.scopes).toEqual([PermissionScopes.Sign]);
    expect(state.origins[ORIGIN]?.eip155?.chains).toEqual([CHAIN_REF]);
    expect(originEvents.length).toBeGreaterThan(0);
  });
});
