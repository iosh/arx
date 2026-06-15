import type { ApprovalChainContextRecord, ApprovalChainContextRequest } from "../../../approvals/chainContext.js";
import type { ChainDefinition } from "../../../chains/definition.js";
import type { ChainRef } from "../../../chains/ids.js";

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

export type UiNetworksSnapshot = {
  selectedNamespace: string;
  active: ChainRef;
  known: ChainView[];
  available: ChainView[];
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
  getSelectedNamespace(): string;
  getSelectedChainView(): ChainView;
  requireChainDefinition(chainRef: ChainRef): ChainDefinition;
  requireAvailableChainDefinition(chainRef: ChainRef): ChainDefinition;
  getActiveChainViewForNamespace(namespace: string): ChainView;
  getApprovalReviewChainView(params: ApprovalReviewChainViewParams): ChainView;
  findAvailableChainView(params: FindAvailableChainViewParams): ChainView | null;
  listKnownChainViews(): ChainView[];
  listAvailableChainViews(): ChainView[];
  buildWalletNetworksSnapshot(): UiNetworksSnapshot;
};
