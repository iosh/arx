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
import { afterEach, describe, expect, it } from "vitest";
import { createDexieChainRegistryPort, createDexieStorage } from "./index.js";

const DB_NAME = "arx-storage-test";

const NETWORK_SNAPSHOT: NetworkSnapshot = {
  version: NETWORK_SNAPSHOT_VERSION,
  updatedAt: Date.now(),
  payload: {
    activeChain: "eip155:1",
    knownChains: [
      {
        chainRef: "eip155:1",
        namespace: "eip155",
        chainId: "0x1",
        displayName: "Ethereum",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcEndpoints: [{ url: "https://rpc.example", type: "public" as const }],
      },
    ],
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
  raw.version(DOMAIN_SCHEMA_VERSION).stores({
    chains: "&namespace",
    accounts: "&namespace",
    permissions: "&namespace",
    approvals: "&namespace",
    transactions: "&namespace",
    vaultMeta: "&id",
    chainRegistry: "&chainRef",
  });
  await raw.open();
  return raw;
};

afterEach(async () => {
  await Dexie.delete(DB_NAME);
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

    await raw.open();
    await raw.table("chains").put({
      namespace: StorageNamespaces.Network,
      envelope: { version: 99, updatedAt: 0, payload: {} },
    });

    await raw.close();

    const reloaded = await storage.loadSnapshot(StorageNamespaces.Network);
    expect(reloaded).toBeNull();
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
    await raw.open();
    await raw.table("vaultMeta").put({
      id: "vault-meta",
      version: 1,
      updatedAt: Date.now(),
      payload: { version: 99 },
    });
    await raw.close();

    expect(await storage.loadVaultMeta()).toBeNull();
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
    await raw.table("permissions").put({
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
  });

  it("drops permissions snapshots when a namespace lacks chain metadata", async () => {
    const storage = createDexieStorage({ databaseName: DB_NAME });

    const raw = await openTestDexie();
    await raw.table("permissions").put({
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
    const raw = new Dexie(DB_NAME);
    raw.version(DOMAIN_SCHEMA_VERSION).stores({
      chains: "&namespace",
      accounts: "&namespace",
      permissions: "&namespace",
      approvals: "&namespace",
      transactions: "&namespace",
      vaultMeta: "&id",
      chainRegistry: "&chainRef",
    });

    await raw.open();
    await raw.table("chainRegistry").put({
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
});
