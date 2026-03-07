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

export type FindAvailableChainViewParams = {
  chainRef?: ChainRef;
  namespace?: string;
};

export type ResolveEip155SwitchChainParams = {
  chainId?: string;
  chainRef?: string;
};

export type ChainViewsService = {
  getActiveChainView(): ChainView;
  requireChainMetadata(chainRef: ChainRef): ChainMetadata;
  requireAvailableChainMetadata(chainRef: ChainRef): ChainMetadata;
  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildUiNetworksSnapshot(): UiNetworksSnapshot;
  buildProviderMeta(): ProviderMetaSnapshot;
  resolveEip155SwitchChain(params: ResolveEip155SwitchChainParams): ChainMetadata;
};
