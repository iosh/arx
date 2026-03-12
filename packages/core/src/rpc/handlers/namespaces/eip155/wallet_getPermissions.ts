import { PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedAllow } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  capability: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedAllow(),
  handler: ({ origin, services, invocation }) => {
    return services.permissionViews.buildWalletPermissions(origin, {
      namespace: invocation.namespace,
      chainRef: invocation.chainRef,
    });
  },
});
