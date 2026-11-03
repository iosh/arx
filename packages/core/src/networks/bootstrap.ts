import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CustomNetworkRecord, NetworkRpcOverrideRecord } from "./persistence.js";

export type NetworksBootstrap = Readonly<{
  customNetworks: readonly CustomNetworkRecord[];
  networkRpcOverrides: readonly NetworkRpcOverrideRecord[];
}>;

export const loadNetworksBootstrap = async (
  readers: Pick<CorePersistenceReaders, "customNetworks" | "networkRpcOverrides">,
): Promise<NetworksBootstrap> => {
  const [customNetworks, networkRpcOverrides] = await Promise.all([
    readers.customNetworks.listAll(),
    readers.networkRpcOverrides.listAll(),
  ]);

  return { customNetworks, networkRpcOverrides };
};
