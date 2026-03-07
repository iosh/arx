import type { ChainRef } from "../../../chains/ids.js";
import type { ChainMetadata } from "../../../chains/metadata.js";

export type ChainView = {
  chainRef: ChainRef;
  chainId: string;
  namespace: string;
  displayName: string;
  shortName: string | null;
  icon: string | null;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type UiNetworksSnapshot = {
  active: ChainRef;
  known: ChainView[];
  available: ChainView[];
};

export type ProviderMetaSnapshot = {
  activeChain: ChainRef;
  activeNamespace: string;
  supportedChains: ChainRef[];
};

export type ResolveEip155SwitchTargetParams = {
  chainId?: string;
  chainRef?: string;
};

export type ChainService = {
  getActiveChainView(): ChainView;
  listKnownChainsView(): ChainView[];
  listAvailableChainsView(): ChainView[];
  buildUiNetworksSnapshot(): UiNetworksSnapshot;
  buildProviderMeta(): ProviderMetaSnapshot;
  resolveEip155SwitchTarget(params: ResolveEip155SwitchTargetParams): ChainMetadata;
};
