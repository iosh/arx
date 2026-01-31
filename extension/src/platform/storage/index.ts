import type { ChainRegistryPort } from "@arx/core/chains";
import type { SettingsPort } from "@arx/core/services";
import type { StoragePort } from "@arx/core/storage";
import {
  createDexieChainRegistryPort,
  createDexieSettingsPort,
  createDexieStorage,
  createDexieStorePorts,
} from "@arx/storage-dexie";

let storageInstance: StoragePort | null = null;
let chainRegistryInstance: ChainRegistryPort | null = null;
let settingsPortInstance: SettingsPort | null = null;
let storePortsInstance: ReturnType<typeof createDexieStorePorts> | null = null;

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

export const getExtensionSettingsPort = (): SettingsPort => {
  if (settingsPortInstance) {
    return settingsPortInstance;
  }
  settingsPortInstance = createDexieSettingsPort({ databaseName: "arx-extension" });
  return settingsPortInstance;
};

export const getExtensionStorePorts = () => {
  if (storePortsInstance) {
    return storePortsInstance;
  }
  storePortsInstance = createDexieStorePorts({ databaseName: "arx-extension" });
  return storePortsInstance;
};
