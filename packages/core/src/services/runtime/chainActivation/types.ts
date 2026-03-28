import type { ChainRef } from "../../../chains/ids.js";

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

export type ChainActivationService = {
  selectWalletChain(chainRef: ChainRef): Promise<void>;
  selectWalletNamespace(namespace: string): Promise<void>;
  activateNamespaceChain(params: ActivateNamespaceChainParams): Promise<void>;
};
