import type { ChainRef } from "../../../chains/ids.js";
import type { AccountKey } from "../../../storage/records.js";
import type { UiPermissionsSnapshot } from "../../../ui/protocol/schemas.js";

export type PermittedAccountView = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type ConnectionSnapshot = {
  namespace: string;
  chainRef: ChainRef;
  isPermittedChain: boolean;
  permittedChainRefs: ChainRef[];
  permittedAccountKeys: AccountKey[];
  accounts: PermittedAccountView[];
  isConnected: boolean;
};

export type PermissionViewsService = {
  getConnectionSnapshot(origin: string, options: { chainRef: ChainRef }): ConnectionSnapshot;
  assertConnected(origin: string, options: { chainRef: ChainRef }): Promise<void>;
  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[];
  // Protocol-specific permission surfaces should adapt from these generic projections.
  buildUiPermissionsSnapshot(): UiPermissionsSnapshot;
};
