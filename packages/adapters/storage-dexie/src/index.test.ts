import "fake-indexeddb/auto";

import {
  DOMAIN_SCHEMA_VERSION,
  NETWORK_SNAPSHOT_VERSION,
  type NetworkSnapshot,
  StorageNamespaces,
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
});
