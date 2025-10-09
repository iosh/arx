import "fake-indexeddb/auto";

import {
  DOMAIN_SCHEMA_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  type NetworkSnapshot,
  StorageNamespaces,
  VAULT_META_SNAPSHOT_VERSION,
  type VaultMetaSnapshot,
} from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDexieStorage } from "./index.js";

const DB_NAME = "arx-storage-test";

const NETWORK_SNAPSHOT: NetworkSnapshot = {
  version: NETWORK_SNAPSHOT_VERSION,
  updatedAt: Date.now(),
  payload: {
    active: {
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      caip2: "eip155:1",
      chainId: "0x1",
      rpcUrl: "https://rpc.example",
    },
    knownChains: [
      {
        caip2: "eip155:1",
        chainId: "0x1",
        rpcUrl: "https://rpc.example",
        name: "Ethereum",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ],
  },
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

    const raw = new Dexie(DB_NAME);
    raw.version(DOMAIN_SCHEMA_VERSION).stores({
      chains: "&namespace",
      accounts: "&namespace",
      permissions: "&namespace",
      approvals: "&namespace",
      transactions: "&namespace",
      vaultMeta: "&id",
    });

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

    const raw = new Dexie(DB_NAME);
    raw.version(DOMAIN_SCHEMA_VERSION).stores({
      chains: "&namespace",
      accounts: "&namespace",
      permissions: "&namespace",
      approvals: "&namespace",
      transactions: "&namespace",
      vaultMeta: "&id",
    });
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
});
