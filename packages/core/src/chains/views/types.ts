import type { ChainRef } from "../../networks/chainRef.js";
import type { ChainDefinition } from "../definition.js";

export type ChainView = {
  chainRef: ChainRef;
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

export type NetworksSnapshot = {
  selectedNamespace: string;
  active: ChainRef;
  known: ChainView[];
  available: ChainView[];
};

export type FindAvailableChainViewParams = {
  chainRef?: ChainRef;
  namespace?: string;
};

export type ChainViewsService = {
  getSelectedNamespace(): string;
  getSelectedChainView(): ChainView;
  requireChainDefinition(chainRef: ChainRef): ChainDefinition;
  requireAvailableChainDefinition(chainRef: ChainRef): ChainDefinition;
  getActiveChainViewForNamespace(namespace: string): ChainView;
  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildWalletNetworksSnapshot(): NetworksSnapshot;
};
