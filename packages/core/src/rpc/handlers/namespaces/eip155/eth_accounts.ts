import { PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE } from "../utils.js";

export const ethAccountsDefinition = defineNoParamsMethod({
  scope: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  handler: ({ origin, controllers, invocation }) => {
    const chainRef = invocation.chainRef;
    const accounts = controllers.permissions.getPermittedAccounts(origin, {
      namespace: EIP155_NAMESPACE,
      chainRef,
    });

    return accounts.map((canonical) => controllers.chainDescriptors.formatAddress({ chainRef, canonical }));
  },
});
