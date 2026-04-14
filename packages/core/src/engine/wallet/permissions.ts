import type { PermissionController } from "../../controllers/permission/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { WalletPermissions } from "../types.js";

// Persistent permissions and their derived read models.
export const createWalletPermissions = (deps: {
  permissions: PermissionController;
  permissionViews: PermissionViewsService;
}): WalletPermissions => {
  const { permissions, permissionViews } = deps;

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
    getConnectionSnapshot: (origin, options) => permissionViews.getConnectionSnapshot(origin, options),
    assertConnected: (origin, options) => permissionViews.assertConnected(origin, options),
    listPermittedAccounts: (origin, options) => permissionViews.listPermittedAccounts(origin, options),
    buildUiPermissionsSnapshot: () => permissionViews.buildUiPermissionsSnapshot(),
    onStateChanged: (listener) => permissions.onStateChanged(listener),
    onOriginChanged: (listener) => permissions.onOriginChanged(listener),
  };
};
