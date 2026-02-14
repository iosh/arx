import { createDefaultChainModuleRegistry } from "../../../../chains/index.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE } from "../utils.js";

const chains = createDefaultChainModuleRegistry();

export const ethAccountsDefinition = defineNoParamsMethod({
  scope: PermissionScopes.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  handler: ({ origin, controllers }) => {
    const active = controllers.network.getActiveChain();
    const accounts = controllers.permissions.getPermittedAccounts(origin, {
      namespace: EIP155_NAMESPACE,
      chainRef: active.chainRef,
    });

    return accounts.map((canonical) => chains.formatAddress({ chainRef: active.chainRef, canonical }));
  },
});
