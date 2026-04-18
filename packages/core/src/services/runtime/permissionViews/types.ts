import type { ChainRef } from "../../../chains/ids.js";
import type { AccountKey } from "../../../storage/records.js";
import type { UiPermissionsSnapshot } from "../../../ui/protocol/schemas.js";

export type PermittedAccountView = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type AuthorizationSnapshot = {
  namespace: string;
  chainRef: ChainRef;
  isPermittedChain: boolean;
  permittedChainRefs: ChainRef[];
  permittedAccountKeys: AccountKey[];
  accounts: PermittedAccountView[];
  isAuthorized: boolean;
};

export type PermissionViewsService = {
  // Generic permission authorization projection consumed by RPC and UI surfaces.
  getAuthorizationSnapshot(origin: string, options: { chainRef: ChainRef }): AuthorizationSnapshot;
  assertAuthorized(origin: string, options: { chainRef: ChainRef }): Promise<void>;
  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[];
  // Protocol-specific permission surfaces adapt from the generic connection projection.
  buildUiPermissionsSnapshot(): UiPermissionsSnapshot;
};
