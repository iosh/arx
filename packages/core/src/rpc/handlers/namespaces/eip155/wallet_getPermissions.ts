import { toCanonicalAddressFromAccountId } from "../../../../accounts/addressing/accountId.js";
import { PermissionCapabilities } from "../../../../controllers/index.js";
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedAllow } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  capability: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedAllow(),
  handler: ({ origin, controllers, invocation }) => {
    const authorization = controllers.permissions.getChainAuthorization(origin, {
      namespace: invocation.namespace,
      chainRef: invocation.chainRef,
    });
    const getAccounts = (chainRef: string, accountIds: readonly string[]) =>
      accountIds.map((accountId) => toCanonicalAddressFromAccountId({ chainRef, accountId }));

    return buildWalletPermissions({ origin, authorization, getAccounts });
  },
});
