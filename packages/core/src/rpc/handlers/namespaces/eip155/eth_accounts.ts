import { toCanonicalAddressFromAccountId } from "../../../../accounts/addressing/accountId.js";
import { PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";

export const ethAccountsDefinition = defineNoParamsMethod({
  capability: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  handler: ({ origin, controllers, invocation }) => {
    const chainRef = invocation.chainRef;
    const authorization = controllers.permissions.getChainAuthorization(origin, {
      namespace: invocation.namespace,
      chainRef,
    });
    if (!authorization || authorization.accountIds.length === 0) {
      return [];
    }

    const accounts = authorization.accountIds.map((accountId) =>
      toCanonicalAddressFromAccountId({ chainRef, accountId }),
    );

    return accounts.map((canonical) => controllers.chainAddressCodecs.formatAddress({ chainRef, canonical }));
  },
});
