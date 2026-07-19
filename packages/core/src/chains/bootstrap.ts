import type { BuiltinNetworkSeed } from "../networks/types.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { ChainRpcOverrideRecord, CustomChainRecord, WalletChainSelectionRecord } from "./persistence.js";
import { createWalletChainSelection, type WalletChainSelectionDefaults } from "./selection.js";

export type NetworksBootstrap = Readonly<{
  builtinSeeds: readonly BuiltinNetworkSeed[];
  customChains: readonly CustomChainRecord[];
  rpcOverrides: readonly ChainRpcOverrideRecord[];
  walletSelection: WalletChainSelectionRecord;
}>;

export const loadNetworksBootstrap = async (params: {
  readers: Pick<CorePersistenceReaders, "customChains" | "chainRpcOverrides" | "walletChainSelection">;
  builtinSeeds: readonly BuiltinNetworkSeed[];
  walletSelectionDefaults: WalletChainSelectionDefaults;
}): Promise<NetworksBootstrap> => {
  const [customChains, rpcOverrides, storedSelection] = await Promise.all([
    params.readers.customChains.listAll(),
    params.readers.chainRpcOverrides.listAll(),
    params.readers.walletChainSelection.get(),
  ]);
  return {
    builtinSeeds: params.builtinSeeds,
    customChains,
    rpcOverrides,
    walletSelection: createWalletChainSelection(params.walletSelectionDefaults, storedSelection),
  };
};
