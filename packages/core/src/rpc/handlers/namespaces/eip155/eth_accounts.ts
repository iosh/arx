import { createDefaultChainModuleRegistry } from "../../../../chains/index.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { NoParamsSchema } from "../../params.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE } from "../utils.js";

export const ethAccountsDefinition: MethodDefinition<undefined> = {
  scope: PermissionScopes.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  paramsSchema: NoParamsSchema,
  handler: ({ origin, controllers }) => {
    const active = controllers.network.getActiveChain();
    const accounts = controllers.permissions.getPermittedAccounts(origin, {
      namespace: EIP155_NAMESPACE,
      chainRef: active.chainRef,
    });

    const chains = createDefaultChainModuleRegistry();
    return accounts.map((canonical) => chains.formatAddress({ chainRef: active.chainRef, canonical }));
  },
};
