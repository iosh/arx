import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { RpcEndpoint } from "../networks/types.js";

export type ChainRpcEndpointOverrideRecord = {
  chainRef: ChainRef;
  rpcEndpoints: RpcEndpoint[];
  updatedAt: number;
};

export type ChainRpcDefaultEndpointsRecord = {
  chainRef: ChainRef;
  rpcEndpoints: RpcEndpoint[];
  source: "bundle" | "request";
  updatedAt: number;
};

export type WalletChainSelectionRecord = {
  id: "wallet-chain-selection";
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
  updatedAt: number;
};

export type ProviderChainSelectionRecord = {
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  updatedAt: number;
};

// Empty means the origin is connected to the chain but has no account access on it.
export type PermissionChainAccountIds = AccountId[];
export type PermissionChainScopes = Record<ChainRef, PermissionChainAccountIds>;

export type PermissionRecord = {
  origin: string;
  namespace: string;
  // One persistent connection-authorization record per (origin, namespace).
  // Request-level signing and transaction approvals remain runtime state.
  chainScopes: PermissionChainScopes;
};
