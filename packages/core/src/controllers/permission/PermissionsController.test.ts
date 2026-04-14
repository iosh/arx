import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import { type PermissionRecord, PermissionRecordSchema } from "../../storage/records.js";
import { PermissionsController } from "./PermissionsController.js";
import { PERMISSION_TOPICS } from "./topics.js";

const ORIGIN = "https://dapp.example";
const NAMESPACE = "eip155";
const SOLANA_NAMESPACE = "solana";
const MAINNET = "eip155:1";
const POLYGON = "eip155:137";
const SOLANA_DEVNET = "solana:101";
const ACCOUNT_ID = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ACCOUNT_ID = "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SOLANA_ACCOUNT_ID = "solana:cccc";

const createRecord = (args: {
  origin?: string;
  namespace?: string;
  chains: Array<{ chainRef: string; accountKeys: string[] }>;
}) =>
  PermissionRecordSchema.parse({
    origin: args.origin ?? ORIGIN,
    namespace: args.namespace ?? NAMESPACE,
    chainScopes: Object.fromEntries(args.chains.map((chain) => [chain.chainRef, chain.accountKeys])),
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

describe("PermissionsController", () => {
  it("grantAuthorization() writes one authorization record and publishes originChanged", async () => {
    const { port, store } = createInMemoryPort();
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });

    const controller = new PermissionsController({
      messenger,
      port,
    });

    const originEvents: unknown[] = [];
    controller.onOriginChanged((payload) => {
      originEvents.push(payload);
    });

    await controller.waitForHydration();
    await controller.grantAuthorization(ORIGIN, {
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
    expect(controller.listOriginPermissions(ORIGIN)).toHaveLength(1);
    expect(originEvents.length).toBeGreaterThan(0);
  });

  it("grantAuthorization() merges granted chains without dropping existing chains", async () => {
    const seed = [
      createRecord({
        chains: [{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }],
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new PermissionsController({ messenger, port });

    await controller.waitForHydration();
    await controller.grantAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chains: [{ chainRef: POLYGON, accountKeys: [] }],
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

  it("setChainAccountKeys() updates only the targeted chain authorization", async () => {
    const seed = [
      createRecord({
        chains: [
          { chainRef: MAINNET, accountKeys: [ACCOUNT_ID] },
          { chainRef: POLYGON, accountKeys: [] },
        ],
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new PermissionsController({ messenger, port });

    await controller.waitForHydration();
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
        [POLYGON]: {
          accountKeys: [],
        },
      },
    });
  });

  it("revokeChainAuthorization() removes only the targeted chain and deletes the record when the last chain is removed", async () => {
    const seed = [
      createRecord({
        chains: [
          { chainRef: MAINNET, accountKeys: [ACCOUNT_ID] },
          { chainRef: POLYGON, accountKeys: [] },
        ],
      }),
    ];

    const { port, store } = createInMemoryPort(seed);
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new PermissionsController({ messenger, port });

    await controller.waitForHydration();
    await controller.revokeChainAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: MAINNET,
    });

    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [POLYGON]: {
          accountKeys: [],
        },
      },
    });

    await controller.revokeChainAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: POLYGON,
    });

    expect(store.size).toBe(0);
    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toBeNull();
  });

  it("revokeNamespaceAuthorization() only removes the targeted namespace record", async () => {
    const seed = [
      createRecord({
        namespace: NAMESPACE,
        chains: [{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }],
      }),
      createRecord({
        namespace: SOLANA_NAMESPACE,
        chains: [{ chainRef: SOLANA_DEVNET, accountKeys: [SOLANA_ACCOUNT_ID] }],
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new PermissionsController({ messenger, port });

    await controller.waitForHydration();
    await controller.revokeNamespaceAuthorization(ORIGIN, {
      namespace: NAMESPACE,
    });

    expect(controller.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toBeNull();
    expect(controller.listOriginPermissions(ORIGIN)).toEqual([
      {
        origin: ORIGIN,
        namespace: SOLANA_NAMESPACE,
        chains: {
          [SOLANA_DEVNET]: {
            accountKeys: [SOLANA_ACCOUNT_ID],
          },
        },
      },
    ]);
  });

  it("grantAuthorization() rejects chainRefs that drift across namespaces", async () => {
    const { port } = createInMemoryPort();
    const messenger = new Messenger().scope({ publish: PERMISSION_TOPICS });
    const controller = new PermissionsController({ messenger, port });

    await controller.waitForHydration();

    await expect(
      controller.grantAuthorization(ORIGIN, {
        namespace: NAMESPACE,
        chains: [{ chainRef: SOLANA_DEVNET, accountKeys: [SOLANA_ACCOUNT_ID] }],
      }),
    ).rejects.toThrow(/does not belong to namespace/i);
  });
});
