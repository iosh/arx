import type { PermissionsEvents, PermissionsReader, PermissionsWriter } from "../../permissions/service/types.js";
import type { WalletPermissions } from "../types.js";

// Persistent authorization facts stored by the permissions service.
export const createWalletPermissions = (deps: {
  permissions: PermissionsReader & PermissionsWriter & PermissionsEvents;
}): WalletPermissions => {
  const { permissions } = deps;

  return {
    getState: () => permissions.getState(),
    getAuthorization: (origin, options) => permissions.getAuthorization(origin, options),
    getChainAuthorization: (origin, options) => permissions.getChainAuthorization(origin, options),
    listOriginPermissions: (origin) => permissions.listOriginPermissions(origin),
    grantAuthorization: (origin, options) => permissions.grantAuthorization(origin, options),
    setChainAccountKeys: (origin, options) => permissions.setChainAccountKeys(origin, options),
    revokeChainAuthorization: (origin, options) => permissions.revokeChainAuthorization(origin, options),
    revokeNamespaceAuthorization: (origin, options) => permissions.revokeNamespaceAuthorization(origin, options),
    revokeOriginPermissions: (origin) => permissions.revokeOriginPermissions(origin),
    onStateChanged: (listener) => permissions.onStateChanged(listener),
    onOriginChanged: (listener) => permissions.onOriginChanged(listener),
  };
};
