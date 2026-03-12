import type { ChainRef } from "../../../chains/ids.js";
import type { WalletPermissionDescriptor } from "../../../permissions/eip2255.js";
import type { AccountId } from "../../../storage/records.js";
import type { UiPermissionsSnapshot } from "../../../ui/protocol/schemas.js";

export type PermittedAccountView = {
  accountId: AccountId;
  canonicalAddress: string;
  displayAddress: string;
};

export type ConnectionSnapshot = {
  namespace: string;
  chainRef: ChainRef;
  isPermittedChain: boolean;
  permittedChainRefs: ChainRef[];
  permittedAccountIds: AccountId[];
  accounts: PermittedAccountView[];
  isConnected: boolean;
};

export type BuildWalletPermissionViewsOptions = {
  chainRef: ChainRef;
  namespace?: string;
};

export type PermissionViewsService = {
  getConnectionSnapshot(origin: string, options: { chainRef: ChainRef }): ConnectionSnapshot;
  assertConnected(origin: string, options: { chainRef: ChainRef }): Promise<void>;
  listPermittedAccounts(origin: string, options: { chainRef: ChainRef }): PermittedAccountView[];
  buildWalletPermissions(origin: string, options: BuildWalletPermissionViewsOptions): WalletPermissionDescriptor[];
  buildUiPermissionsSnapshot(): UiPermissionsSnapshot;
};
