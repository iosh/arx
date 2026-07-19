import type { ChainRef } from "../../networks/chainRef.js";

export const NamespaceChainActivationReasons = {
  SwitchChain: "switch-chain",
  Compatibility: "compatibility",
} as const;

export type NamespaceChainActivationReason =
  (typeof NamespaceChainActivationReasons)[keyof typeof NamespaceChainActivationReasons];

export type ActivateNamespaceChainParams = {
  namespace: string;
  chainRef: ChainRef;
  reason: NamespaceChainActivationReason;
};

export type SelectProviderChainParams = ActivateNamespaceChainParams & {
  origin: string;
};

export type ChainActivationService = {
  selectWalletChain(chainRef: ChainRef): Promise<void>;
  selectWalletNamespace(namespace: string): Promise<void>;
  activateNamespaceChain(params: ActivateNamespaceChainParams): Promise<void>;
  selectProviderChain(params: SelectProviderChainParams): Promise<void>;
};
