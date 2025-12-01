import type { ChainRegistryPort } from "@arx/core/chains";
import type { KeyringStorePort, StoragePort } from "@arx/core/storage";
import { createDexieChainRegistryPort, createDexieKeyringStore, createDexieStorage } from "@arx/storage-dexie";

let storageInstance: StoragePort | null = null;
let chainRegistryInstance: ChainRegistryPort | null = null;
let keyringStoreInstance: KeyringStorePort | null = null;

export const getExtensionStorage = (): StoragePort => {
  if (storageInstance) {
    return storageInstance;
  }
  storageInstance = createDexieStorage({ databaseName: "arx-extension" });
  return storageInstance;
};

export const getExtensionChainRegistry = (): ChainRegistryPort => {
  if (chainRegistryInstance) {
    return chainRegistryInstance;
  }
  chainRegistryInstance = createDexieChainRegistryPort({ databaseName: "arx-extension" });
  return chainRegistryInstance;
};

export const getExtensionKeyringStore = (): KeyringStorePort => {
  if (keyringStoreInstance) {
    return keyringStoreInstance;
  }
  keyringStoreInstance = createDexieKeyringStore({ databaseName: "arx-extension" });
  return keyringStoreInstance;
};
