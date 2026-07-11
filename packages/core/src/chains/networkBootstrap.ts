import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "./definition.js";
import type { CustomChainRecord } from "./definitions/persistence.js";
import type { ChainRpcOverrideRecord } from "./rpc/endpointOverrides/persistence.js";
import type { WalletChainSelectionRecord } from "./selection/wallet/persistence.js";
import { createWalletChainSelection, type WalletChainSelectionDefaults } from "./WalletChainSelection.js";

export type NetworksBootstrap = Readonly<{
  builtinSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
  customChains: readonly CustomChainRecord[];
  rpcOverrides: readonly ChainRpcOverrideRecord[];
  walletSelection: WalletChainSelectionRecord;
}>;

export const loadNetworksBootstrap = async (params: {
  readers: Pick<CorePersistenceReaders, "customChains" | "chainRpcOverrides" | "walletChainSelection">;
  builtinSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
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
