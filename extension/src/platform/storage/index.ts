import type { ChainRegistryPort } from "@arx/core/chains";
import type { SettingsPort } from "@arx/core/services";
import type { NetworkRpcPort, VaultMetaPort } from "@arx/core/storage";
import {
  createDexieChainRegistryPort,
  createDexieNetworkRpcPort,
  createDexieSettingsPort,
  createDexieStorePorts,
  createDexieVaultMetaPort,
} from "@arx/storage-dexie";

let chainRegistryInstance: ChainRegistryPort | null = null;
let settingsPortInstance: SettingsPort | null = null;
let storePortsInstance: ReturnType<typeof createDexieStorePorts> | null = null;
let networkRpcPortInstance: NetworkRpcPort | null = null;
let vaultMetaPortInstance: VaultMetaPort | null = null;

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

export const getExtensionNetworkRpcPort = (): NetworkRpcPort => {
  if (networkRpcPortInstance) {
    return networkRpcPortInstance;
  }
  networkRpcPortInstance = createDexieNetworkRpcPort({ databaseName: "arx-extension" });
  return networkRpcPortInstance;
};

export const getExtensionVaultMetaPort = (): VaultMetaPort => {
  if (vaultMetaPortInstance) {
    return vaultMetaPortInstance;
  }
  vaultMetaPortInstance = createDexieVaultMetaPort({ databaseName: "arx-extension" });
  return vaultMetaPortInstance;
};

export const getExtensionStorePorts = () => {
  if (storePortsInstance) {
    return storePortsInstance;
  }
  storePortsInstance = createDexieStorePorts({ databaseName: "arx-extension" });
  return storePortsInstance;
};
