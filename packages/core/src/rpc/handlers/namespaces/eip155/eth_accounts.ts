import { ArxReasons, arxError } from "@arx/errors";
import { createDefaultChainModuleRegistry } from "../../../../chains/index.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import { lockedResponse } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE, toParamsArray } from "../utils.js";

export const ethAccountsDefinition: MethodDefinition = {
  scope: PermissionScopes.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedResponse([]),
  validateParams: (params) => {
    const arr = toParamsArray(params);
    if (arr.length !== 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_accounts does not accept parameters",
        data: { params },
      });
    }
  },
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
