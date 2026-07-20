import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CustomNetworkRecord, NetworkRpcOverrideRecord, NetworkSelectionRecord } from "./persistence.js";

export type NetworksBootstrap = Readonly<{
  customNetworks: readonly CustomNetworkRecord[];
  networkRpcOverrides: readonly NetworkRpcOverrideRecord[];
  selection: NetworkSelectionRecord | null;
}>;

export const loadNetworksBootstrap = async (
  readers: Pick<CorePersistenceReaders, "customNetworks" | "networkRpcOverrides" | "networkSelection">,
): Promise<NetworksBootstrap> => {
  const [customNetworks, networkRpcOverrides, selection] = await Promise.all([
    readers.customNetworks.listAll(),
    readers.networkRpcOverrides.listAll(),
    readers.networkSelection.get(),
  ]);

  return { customNetworks, networkRpcOverrides, selection };
};
