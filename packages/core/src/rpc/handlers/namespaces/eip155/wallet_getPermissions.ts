import type { ChainRef } from "../../../../chains/ids.js";
import { PermissionCapabilities } from "../../../../controllers/index.js";
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedAllow } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE } from "../utils.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  scope: PermissionCapabilities.Basic,
  permissionCheck: PermissionChecks.None,
  locked: lockedAllow(),
  handler: ({ origin, controllers }) => {
    const grants = controllers.permissions.listGrants(origin);
    const getAccounts = (chainRef: string) =>
      controllers.permissions.getPermittedAccounts(origin, {
        namespace: EIP155_NAMESPACE,
        chainRef: chainRef as ChainRef,
      });

    return buildWalletPermissions({ origin, grants, getAccounts });
  },
});
