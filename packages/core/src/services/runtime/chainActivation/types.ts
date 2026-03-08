import type { ChainRef } from "../../../chains/ids.js";

export const ChainSelectionSyncPolicies = {
  Always: "always",
  Never: "never",
  IfSelectedNamespaceMatches: "if-selected-namespace-matches",
} as const;

export type ChainSelectionSyncPolicy = (typeof ChainSelectionSyncPolicies)[keyof typeof ChainSelectionSyncPolicies];

export const ProviderChainActivationReasons = {
  SwitchChain: "switch-chain",
  Compatibility: "compatibility",
} as const;

export type ProviderChainActivationReason =
  (typeof ProviderChainActivationReasons)[keyof typeof ProviderChainActivationReasons];

export type ActivateProviderChainParams = {
  namespace: string;
  chainRef: ChainRef;
  reason: ProviderChainActivationReason;
  syncSelectedChain?: ChainSelectionSyncPolicy;
};

export type ChainActivationService = {
  activate(chainRef: ChainRef): Promise<void>;
  selectWalletChain(chainRef: ChainRef): Promise<void>;
  activateProviderChain(params: ActivateProviderChainParams): Promise<void>;
};
