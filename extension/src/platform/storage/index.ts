import type { ChainRegistryPort } from "@arx/core/chains";
import type { NetworkPreferencesPort, SettingsPort } from "@arx/core/services";
import type { VaultMetaPort } from "@arx/core/storage";
import {
  createDexieChainRegistryPort,
  createDexieNetworkPreferencesPort,
  createDexieSettingsPort,
  createDexieStorePorts,
  createDexieVaultMetaPort,
} from "@arx/storage-dexie";

let chainRegistryInstance: ChainRegistryPort | null = null;
let settingsPortInstance: SettingsPort | null = null;
let storePortsInstance: ReturnType<typeof createDexieStorePorts> | null = null;
let networkPreferencesPortInstance: NetworkPreferencesPort | null = null;
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

export const getExtensionNetworkPreferencesPort = (): NetworkPreferencesPort => {
  if (networkPreferencesPortInstance) {
    return networkPreferencesPortInstance;
  }
  networkPreferencesPortInstance = createDexieNetworkPreferencesPort({ databaseName: "arx-extension" });
  return networkPreferencesPortInstance;
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
