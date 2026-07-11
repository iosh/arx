import type { AccountId } from "../accounts/addressing/accountId.js";
import type { ChainRef } from "../chains/ids.js";
import type { PermissionRecord } from "./persistence.js";

export const removeAccountsFromPermissions = (
  permissions: readonly PermissionRecord[],
  accountIds: readonly AccountId[],
): PermissionRecord[] => {
  const removed = new Set(accountIds);
  return permissions.map((permission) => ({
    ...permission,
    chainScopes: Object.fromEntries(
      Object.entries(permission.chainScopes).map(([chainRef, ids]) => [
        chainRef,
        ids.filter((accountId) => !removed.has(accountId)),
      ]),
    ),
  }));
};

export const removeChainFromPermissions = (
  permissions: readonly PermissionRecord[],
  chainRef: ChainRef,
): PermissionRecord[] =>
  permissions.map((permission) => ({
    ...permission,
    chainScopes: Object.fromEntries(Object.entries(permission.chainScopes).filter(([key]) => key !== chainRef)),
  }));
