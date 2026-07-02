import { describe, expect, it } from "vitest";
import { createMessenger } from "../../messenger/index.js";
import type { PermissionsPort } from "../../services/store/permissions/port.js";
import type { PermissionRecord } from "../../storage/records.js";
import { PermissionsService } from "./PermissionsService.js";

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
  ({
    origin: args.origin ?? ORIGIN,
    namespace: args.namespace ?? NAMESPACE,
    chainScopes: Object.fromEntries(args.chains.map((chain) => [chain.chainRef, chain.accountKeys])),
  }) satisfies PermissionRecord;

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
      store.set(toKey(record), record);
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

describe("PermissionsService", () => {
  it("grantAuthorization() writes one authorization record and publishes originChanged", async () => {
    const { port, store } = createInMemoryPort();
    const messenger = createMessenger();

    const service = new PermissionsService({
      messenger,
      port,
    });

    const originEvents: unknown[] = [];
    service.onOriginChanged((payload) => {
      originEvents.push(payload);
    });

    await service.waitForHydration();
    await service.grantAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chains: [{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }],
    });

    expect(store.size).toBe(1);
    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [MAINNET]: {
          accountKeys: [ACCOUNT_ID],
        },
      },
    });
    expect(service.listOriginPermissions(ORIGIN)).toHaveLength(1);
    expect(originEvents.length).toBeGreaterThan(0);
  });

  it("grantAuthorization() merges granted chains without dropping existing chains", async () => {
    const seed = [
      createRecord({
        chains: [{ chainRef: MAINNET, accountKeys: [ACCOUNT_ID] }],
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const messenger = createMessenger();
    const service = new PermissionsService({ messenger, port });

    await service.waitForHydration();
    await service.grantAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chains: [{ chainRef: POLYGON, accountKeys: [] }],
    });

    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
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
    const messenger = createMessenger();
    const service = new PermissionsService({ messenger, port });

    await service.waitForHydration();
    await service.setChainAccountKeys(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: MAINNET,
      accountKeys: [OTHER_ACCOUNT_ID],
    });

    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
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
    const messenger = createMessenger();
    const service = new PermissionsService({ messenger, port });

    await service.waitForHydration();
    await service.revokeChainAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: MAINNET,
    });

    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toEqual({
      origin: ORIGIN,
      namespace: NAMESPACE,
      chains: {
        [POLYGON]: {
          accountKeys: [],
        },
      },
    });

    await service.revokeChainAuthorization(ORIGIN, {
      namespace: NAMESPACE,
      chainRef: POLYGON,
    });

    expect(store.size).toBe(0);
    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toBeNull();
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
    const messenger = createMessenger();
    const service = new PermissionsService({ messenger, port });

    await service.waitForHydration();
    await service.revokeNamespaceAuthorization(ORIGIN, {
      namespace: NAMESPACE,
    });

    expect(service.getAuthorization(ORIGIN, { namespace: NAMESPACE })).toBeNull();
    expect(service.listOriginPermissions(ORIGIN)).toEqual([
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
    const messenger = createMessenger();
    const service = new PermissionsService({ messenger, port });

    await service.waitForHydration();

    await expect(
      service.grantAuthorization(ORIGIN, {
        namespace: NAMESPACE,
        chains: [{ chainRef: SOLANA_DEVNET, accountKeys: [SOLANA_ACCOUNT_ID] }],
      }),
    ).rejects.toThrow(/does not belong to namespace/i);
  });
});
