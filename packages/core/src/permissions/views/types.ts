import type { AccountId } from "../../accounts/accountId.js";
import type { ChainRef } from "../../networks/chainRef.js";

export type PermissionsSnapshot = {
  origins: Record<string, Record<string, { chains: Record<ChainRef, { accountIds: AccountId[] }> }>>;
};

export type PermittedAccountView = {
  accountId: AccountId;
  canonicalAddress: string;
  displayAddress: string;
};

export type AuthorizationSnapshot = {
  namespace: string;
  chainRef: ChainRef;
  isPermittedChain: boolean;
  permittedChainRefs: ChainRef[];
  permittedAccountIds: AccountId[];
  accounts: PermittedAccountView[];
  isAuthorized: boolean;
};

export type PermissionViewsService = {
  // Generic permission authorization projection consumed by RPC and UI surfaces.
  getAuthorizationSnapshot(origin: string, options: { chainRef: ChainRef }): AuthorizationSnapshot;
  assertAuthorized(origin: string, options: { chainRef: ChainRef }): Promise<void>;
  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[];
  // Protocol-specific permission surfaces adapt from the generic connection projection.
  buildPermissionsSnapshot(): PermissionsSnapshot;
};
