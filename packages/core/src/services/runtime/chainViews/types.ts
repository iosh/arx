import type { ApprovalChainContextRecord, ApprovalChainContextRequest } from "../../../approvals/chainContext.js";
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
  activeChainByNamespace: Record<string, ChainRef>;
  supportedChains: ChainRef[];
};

export type FindAvailableChainViewParams = {
  chainRef?: ChainRef;
  namespace?: string;
};

export type ApprovalReviewChainViewParams = {
  record: ApprovalChainContextRecord;
  request?: ApprovalChainContextRequest;
};

export type ChainViewsService = {
  getSelectedChainView(): ChainView;
  requireChainMetadata(chainRef: ChainRef): ChainMetadata;
  requireAvailableChainMetadata(chainRef: ChainRef): ChainMetadata;
  getActiveChainViewForNamespace(namespace: string): ChainView;
  getApprovalReviewChainView(params: ApprovalReviewChainViewParams): ChainView;
  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildWalletNetworksSnapshot(): UiNetworksSnapshot;
  buildProviderMeta(namespace: string): ProviderMetaSnapshot;
};
