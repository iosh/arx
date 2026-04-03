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
    listAuthorizations: (origin) => permissions.listAuthorizations(origin),
    upsertAuthorization: (origin, options) => permissions.upsertAuthorization(origin, options),
    setChainAccountKeys: (origin, options) => permissions.setChainAccountKeys(origin, options),
    addPermittedChains: (origin, options) => permissions.addPermittedChains(origin, options),
    revokePermittedChains: (origin, options) => permissions.revokePermittedChains(origin, options),
    clearOrigin: (origin) => permissions.clearOrigin(origin),
    getConnectionSnapshot: (origin, options) => permissionViews.getConnectionSnapshot(origin, options),
    assertConnected: (origin, options) => permissionViews.assertConnected(origin, options),
    listPermittedAccounts: (origin, options) => permissionViews.listPermittedAccounts(origin, options),
    buildUiPermissionsSnapshot: () => permissionViews.buildUiPermissionsSnapshot(),
    onStateChanged: (listener) => permissions.onStateChanged(listener),
    onOriginChanged: (listener) => permissions.onOriginChanged(listener),
  };
};
