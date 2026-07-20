import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../networks/chainRef.js";

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
