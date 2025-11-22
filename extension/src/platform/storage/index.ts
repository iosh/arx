import type { ChainRegistryPort } from "@arx/core/chains";
import type { StoragePort } from "@arx/core/storage";
import { createDexieChainRegistryPort, createDexieStorage } from "@arx/storage-dexie";

let storageInstance: StoragePort | null = null;
let chainRegistryInstance: ChainRegistryPort | null = null;

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
