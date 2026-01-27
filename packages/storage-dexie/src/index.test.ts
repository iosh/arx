import "fake-indexeddb/auto";

import { ApprovalTypes, PermissionScopes } from "@arx/core";
import {
  AccountMetaSchema,
  APPROVALS_SNAPSHOT_VERSION,
  type ApprovalsSnapshot,
  CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
  type ChainRegistryEntity,
  DOMAIN_SCHEMA_VERSION,
  KEYRING_VAULT_ENTRY_VERSION,
  KeyringMetaSchema,
  NETWORK_SNAPSHOT_VERSION,
  type NetworkSnapshot,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  VAULT_META_SNAPSHOT_VERSION,
  VaultKeyringPayloadSchema,
  type VaultMetaSnapshot,
} from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDexieChainRegistryPort,
  createDexieKeyringStore,
  createDexieSettingsPort,
  createDexieStorage,
} from "./index.js";

const DB_NAME = "arx-storage-test";
const TEST_DB_STORES = {
  snapshots: "&namespace",

  settings: "&id",
  chains: "&chainRef",
  accounts: "&accountId, namespace, keyringId",
  permissions: "&id, origin, &[origin+namespace+chainRef]",
  approvals: "&id, status, type, origin, createdAt",
  transactions: "&id, status, chainRef, hash, createdAt, updatedAt, [chainRef+createdAt], [status+createdAt]",

  vaultMeta: "&id",

  keyringMetas: "&id, type, createdAt",
  accountMetas: "&address, keyringId, createdAt, [keyringId+hidden]",
} as const;

const NETWORK_SNAPSHOT: NetworkSnapshot = {
  version: NETWORK_SNAPSHOT_VERSION,
  updatedAt: Date.now(),
  payload: {
    rpc: {
      "eip155:1": {
        activeIndex: 0,
        endpoints: [{ index: 0, url: "https://rpc.example", type: "public" as const }],
        health: [{ index: 0, successCount: 0, failureCount: 0, consecutiveFailures: 0 }],
        strategy: { id: "round-robin" },
        lastUpdatedAt: Date.now(),
      },
    },
  },
};

const APPROVALS_SNAPSHOT: ApprovalsSnapshot = {
  version: APPROVALS_SNAPSHOT_VERSION,
  updatedAt: Date.now(),
  payload: {
    pending: [
      {
        id: "approval-1",
        type: ApprovalTypes.RequestAccounts,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: Date.now(),
      },
    ],
  },
};

const openTestDexie = async () => {
  const raw = new Dexie(DB_NAME);
  raw.version(DOMAIN_SCHEMA_VERSION).stores(TEST_DB_STORES);
  await raw.open();
  return raw;
};

const putRawSnapshot = async (raw: Dexie, params: { namespace: string; envelope: unknown }) => {
  await raw.table("snapshots").put({ namespace: params.namespace, envelope: params.envelope });
};

const originalWarn = console.warn.bind(console);

const shouldSilenceWarn = (args: unknown[]) => {
  const first = args[0];
  if (typeof first !== "string") return false;
  return (
    first.startsWith("[storage-dexie]") ||
    first.includes("Another connection wants to delete database") ||
    first.includes("Closing db now to resume the delete request")
  );
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (shouldSilenceWarn(args)) return;
    originalWarn(...(args as any[]));
  });
});

afterEach(async () => {
  await Dexie.delete(DB_NAME);
  warnSpy.mockRestore();
});

describe("DexieStoragePort", () => {
  it("persists and loads a snapshot", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    await storage.saveSnapshot(StorageNamespaces.Network, NETWORK_SNAPSHOT);

    const result = await storage.loadSnapshot(StorageNamespaces.Network);

    expect(result).toEqual(NETWORK_SNAPSHOT);
  });

  it("drops invalid snapshots on load", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    await storage.saveSnapshot(StorageNamespaces.Network, NETWORK_SNAPSHOT);

    const raw = await openTestDexie();

    await putRawSnapshot(raw, {
      namespace: StorageNamespaces.Network,
      envelope: { version: 99, updatedAt: 0, payload: {} },
    });

    await raw.close();

    const reloaded = await storage.loadSnapshot(StorageNamespaces.Network);
    expect(reloaded).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid snapshot detected for core:network"),
      expect.anything(),
    );
  });

  it("persists and loads vault meta snapshot", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });
    const snapshot: VaultMetaSnapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: Date.now(),
      payload: {
        ciphertext: {
          version: 1,
          algorithm: "pbkdf2-sha256",
          salt: "c2FsdA==",
          iterations: 600_000,
          iv: "YWJj",
          cipher: "ZGVm",
          createdAt: Date.now(),
        },
        autoLockDuration: 900_000,
        initializedAt: Date.now(),
      },
    };

    await storage.saveVaultMeta(snapshot);
    expect(await storage.loadVaultMeta()).toEqual(snapshot);
  });

  it("drops invalid vault meta snapshot on load", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    await storage.saveVaultMeta({
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: Date.now(),
      payload: {
        ciphertext: null,
        autoLockDuration: 900_000,
        initializedAt: Date.now(),
      },
    });

    const raw = await openTestDexie();
    await raw.table("vaultMeta").put({
      id: "vault-meta",
      version: 1,
      updatedAt: Date.now(),
      payload: { version: 99 },
    });
    await raw.close();

    expect(await storage.loadVaultMeta()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid vault meta detected"),
      expect.anything(),
    );
  });

  it("persists and loads approvals snapshot with metadata", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    await storage.saveSnapshot(StorageNamespaces.Approvals, APPROVALS_SNAPSHOT);
    const loaded = await storage.loadSnapshot(StorageNamespaces.Approvals);

    expect(loaded).toEqual(APPROVALS_SNAPSHOT);
  });

  it("drops legacy permissions snapshots missing chain metadata", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    const raw = await openTestDexie();
    await putRawSnapshot(raw, {
      namespace: StorageNamespaces.Permissions,
      envelope: {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        updatedAt: Date.now(),
        payload: {
          origins: {
            "https://dapp.example": {
              eip155: {
                scopes: [PermissionScopes.Basic],
                // chains omitted on purpose
              },
            },
          },
        },
      },
    });
    await raw.close();

    expect(await storage.loadSnapshot(StorageNamespaces.Permissions)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid snapshot detected for core:permissions"),
      expect.anything(),
    );
  });

  it("drops permissions snapshots when a namespace lacks chain metadata", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    const raw = await openTestDexie();
    await putRawSnapshot(raw, {
      namespace: StorageNamespaces.Permissions,
      envelope: {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        updatedAt: Date.now(),
        payload: {
          origins: {
            "https://dapp.example": {
              eip155: {
                scopes: [PermissionScopes.Basic],
                chains: ["eip155:1"],
              },
              conflux: {
                scopes: [PermissionScopes.Sign],
              },
            },
          },
        },
      },
    });
    await raw.close();

    expect(await storage.loadSnapshot(StorageNamespaces.Permissions)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid snapshot detected for core:permissions"),
      expect.anything(),
    );
  });
});

describe("DexieSettingsPort", () => {
  it("stores and reads the settings row", async () => {
    const port = createDexieSettingsPort({ databaseName: DB_NAME });

    const record = {
      id: "settings" as const,
      activeChainRef: "eip155:1",
      updatedAt: 1_706_000_000_000,
    };

    await port.put(record);
    expect(await port.get()).toEqual(record);
  });

  it("drops invalid settings rows on read", async () => {
    const port = createDexieSettingsPort({ databaseName: DB_NAME });

    const raw = await openTestDexie();
    await raw.table("settings").put({
      id: "settings",
      // activeChainRef missing -> invalid
      updatedAt: 0,
    });
    await raw.close();

    const loaded = await port.get();
    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid settings detected, dropping"),
      expect.anything(),
    );

    // Ensure the invalid row is removed.
    const raw2 = await openTestDexie();
    expect(await raw2.table("settings").get("settings")).toBeUndefined();
    await raw2.close();
  });
});

describe("DexieChainRegistryPort", () => {
  const createEntity = (params: { chainRef: string; chainId: string; updatedAt: number }): ChainRegistryEntity => ({
    chainRef: params.chainRef,
    namespace: "eip155",
    metadata: {
      chainRef: params.chainRef,
      namespace: "eip155",
      chainId: params.chainId,
      displayName: `Chain ${params.chainRef}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [{ url: `https://rpc.${params.chainRef.replace(/:/g, "-")}.example`, type: "public" }],
    },
    schemaVersion: CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
    updatedAt: params.updatedAt,
  });

  it("stores, reads, and clears chain entries", async () => {
    const port = createDexieChainRegistryPort({ databaseName: DB_NAME });
    const mainnet = createEntity({ chainRef: "eip155:1", chainId: "0x1", updatedAt: 1_706_000_000_000 });
    const optimism = createEntity({ chainRef: "eip155:10", chainId: "0xa", updatedAt: 1_706_000_100_000 });

    await port.put(mainnet);
    await port.putMany([optimism]);

    expect(await port.get(mainnet.chainRef)).toEqual(mainnet);
    expect(await port.getAll()).toEqual(expect.arrayContaining([mainnet, optimism]));

    await port.delete(mainnet.chainRef);
    expect(await port.get(mainnet.chainRef)).toBeNull();

    await port.clear();
    expect(await port.getAll()).toEqual([]);
  });

  it("drops invalid entries encountered during reads", async () => {
    const raw = await openTestDexie();

    await raw.table("chains").put({
      chainRef: "eip155:1",
      namespace: "eip155",
      metadata: {
        chainRef: "eip155:999",
        namespace: "eip155",
        chainId: "0x3e7",
        displayName: "Corrupted",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcEndpoints: [{ url: "https://invalid.rpc", type: "public" }],
      },
      schemaVersion: CHAIN_REGISTRY_ENTITY_SCHEMA_VERSION,
      updatedAt: 1_706_000_000_000,
    });
    await raw.close();

    const port = createDexieChainRegistryPort({ databaseName: DB_NAME });

    expect(await port.get("eip155:1")).toBeNull();
    expect(await port.getAll()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[storage-dexie] invalid chain registry entry detected"),
      expect.anything(),
    );
  });

  describe("keyring storage schemas", () => {
    const TS = 1_706_000_000_000;

    it("accepts keyring/account meta and vault payload", () => {
      const keyringMeta = {
        id: "11111111-2222-4333-8444-555555555555",
        type: "hd" as const,
        createdAt: TS,
        backedUp: false,
        derivedCount: 1,
      };
      const accountMeta = {
        address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        keyringId: keyringMeta.id,
        derivationIndex: 0,
        createdAt: TS,
        namespace: "eip155",
      };
      const payload = {
        keyrings: [
          {
            keyringId: keyringMeta.id,
            type: "hd" as const,
            createdAt: TS,
            version: KEYRING_VAULT_ENTRY_VERSION,
            payload: { mnemonic: Array(12).fill("test"), passphrase: "pass" },
          },
          {
            keyringId: "66666666-7777-8888-9999-000000000000",
            type: "private-key" as const,
            createdAt: TS,
            version: KEYRING_VAULT_ENTRY_VERSION,
            payload: { privateKey: `0x${"a".repeat(64)}` },
          },
        ],
      };

      expect(KeyringMetaSchema.parse(keyringMeta)).toStrictEqual(keyringMeta);
      expect(AccountMetaSchema.parse(accountMeta)).toStrictEqual(accountMeta);
      expect(VaultKeyringPayloadSchema.parse(payload)).toStrictEqual(payload);
    });

    it("rejects non-canonical addresses", () => {
      const invalid = {
        address: "0xABCDEFabcdefabcdefabcdefabcdefabcdefabcd",
        keyringId: "11111111-2222-3333-4444-555555555555",
        createdAt: TS,
      };
      expect(AccountMetaSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("DexieKeyringStorePort", () => {
    const TS = 1_706_000_000_123;
    const keyringMeta = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      type: "hd" as const,
      createdAt: TS,
      derivedCount: 2,
      backedUp: false,
    };
    const accountMeta = {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      keyringId: keyringMeta.id,
      derivationIndex: 1,
      createdAt: TS,
      namespace: "eip155",
    };

    it("stores and loads keyring/account metas", async () => {
      const store = createDexieKeyringStore({ databaseName: DB_NAME });

      await store.putKeyringMetas([keyringMeta]);
      await store.putAccountMetas([accountMeta]);

      expect(await store.getKeyringMetas()).toEqual([keyringMeta]);
      expect(await store.getAccountMetas()).toEqual([accountMeta]);
    });

    it("drops invalid rows on read", async () => {
      const store = createDexieKeyringStore({ databaseName: DB_NAME });
      const raw = await openTestDexie();

      await raw.table("keyringMetas").put({ ...keyringMeta, id: "bad-id" });
      await raw.table("accountMetas").put({
        ...accountMeta,
        address: "0xABCDEFabcdefabcdefabcdefabcdefabcdefabcd",
      });
      await raw.close();

      expect(await store.getKeyringMetas()).toEqual([]);
      expect(await store.getAccountMetas()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[storage-dexie] invalid keyring meta, dropping"),
        expect.anything(),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[storage-dexie] invalid account meta, dropping"),
        expect.anything(),
      );
    });

    it("deletes accounts when keyring is deleted", async () => {
      const store = createDexieKeyringStore({ databaseName: DB_NAME });
      await store.putKeyringMetas([keyringMeta]);
      await store.putAccountMetas([
        accountMeta,
        { ...accountMeta, address: "0xffffffffffffffffffffffffffffffffffffffff", derivationIndex: 2 },
      ]);

      await store.deleteKeyringMeta(keyringMeta.id);

      expect(await store.getKeyringMetas()).toEqual([]);
      expect(await store.getAccountMetas()).toEqual([]);
    });
  });
});
