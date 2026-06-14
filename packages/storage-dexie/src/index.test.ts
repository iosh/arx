import "fake-indexeddb/auto";

import {
  type ChainRpcDefaultEndpointsRecord,
  type ProviderChainSelectionRecord,
  VAULT_META_SNAPSHOT_VERSION,
  type VaultMetaSnapshot,
  type WalletChainSelectionRecord,
} from "@arx/core/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDexieStorage } from "./createDexieStorage.js";

const DB_NAME = "arx-storage-index-test";
const storages: Array<ReturnType<typeof createDexieStorage>> = [];

const createTestStorage = (): ReturnType<typeof createDexieStorage> => {
  const storage = createDexieStorage({ databaseName: DB_NAME });
  storages.push(storage);
  return storage;
};

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  await Dexie.delete(DB_NAME);
});

describe("@arx/storage-dexie", () => {
  it("WalletChainSelectionPort roundtrips", async () => {
    const storage = createTestStorage();
    const port = storage.ports.chains.walletChainSelection;

    const record = {
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: "eip155:1" },
      updatedAt: 1_000,
    } satisfies WalletChainSelectionRecord;

    await port.put(record);
    expect(await port.get()).toEqual(record);
  });

  it("ProviderChainSelectionPort roundtrips per origin and namespace", async () => {
    const storage = createTestStorage();
    const port = storage.ports.chains.providerChainSelection;

    const first = {
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      updatedAt: 1_000,
    } satisfies ProviderChainSelectionRecord;
    const second = {
      origin: "https://other.example",
      namespace: "eip155",
      chainRef: "eip155:10",
      updatedAt: 2_000,
    } satisfies ProviderChainSelectionRecord;

    await port.upsert(first);
    await port.upsert(second);

    expect(await port.get({ origin: first.origin, namespace: first.namespace })).toEqual(first);
    expect(await port.listAll()).toEqual(expect.arrayContaining([first, second]));

    await port.remove({ origin: first.origin, namespace: first.namespace });
    expect(await port.get({ origin: first.origin, namespace: first.namespace })).toBeNull();
    expect(await port.get({ origin: second.origin, namespace: second.namespace })).toEqual(second);
  });

  it("ChainRpcDefaultEndpointsPort roundtrips by chainRef", async () => {
    const storage = createTestStorage();
    const port = storage.ports.chains.chainRpcDefaultEndpoints;

    const record = {
      chainRef: "eip155:1",
      rpcEndpoints: [{ url: "https://rpc.mainnet.example", type: "public" }],
      updatedAt: 1_000,
    } satisfies ChainRpcDefaultEndpointsRecord;

    await port.upsert(record);
    expect(await port.get(record.chainRef)).toEqual(record);
    expect(await port.list()).toEqual([record]);

    await port.remove(record.chainRef);
    expect(await port.get(record.chainRef)).toBeNull();
  });

  it("VaultMetaPort roundtrips", async () => {
    const storage = createTestStorage();
    const port = storage.ports.vault;

    const snapshot = {
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        envelope: null,
        autoLockDurationMs: 900_000,
        initializedAt: 1_000,
      },
    } satisfies VaultMetaSnapshot;

    await port.saveVaultMeta(snapshot);
    expect(await port.loadVaultMeta()).toEqual(snapshot);
  });
});
