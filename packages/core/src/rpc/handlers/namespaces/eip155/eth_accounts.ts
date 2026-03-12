import { PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";

export const ethAccountsDefinition = defineNoParamsMethod({
  capability: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  handler: ({ origin, controllers, services, invocation }) => {
    const chainRef = invocation.chainRef;
    return services.permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) =>
        controllers.chainAddressCodecs.formatAddress({ chainRef, canonical: account.canonicalAddress }),
      );
  },
});
