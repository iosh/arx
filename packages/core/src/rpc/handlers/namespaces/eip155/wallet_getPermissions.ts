import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../../chains/ids.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedAllow } from "../../locked.js";
import type { MethodDefinition } from "../../types.js";
import { EIP155_NAMESPACE, toParamsArray } from "../utils.js";

export const walletGetPermissionsDefinition: MethodDefinition = {
  scope: PermissionScopes.Basic,
  locked: lockedAllow(),
  isBootstrap: true,
  validateParams: (params) => {
    const arr = toParamsArray(params);
    if (arr.length !== 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_getPermissions does not accept parameters",
        data: { params },
      });
    }
  },
  handler: ({ origin, controllers }) => {
    const grants = controllers.permissions.listGrants(origin);
    const getAccounts = (chainRef: string) =>
      controllers.permissions.getPermittedAccounts(origin, {
        namespace: EIP155_NAMESPACE,
        chainRef: chainRef as ChainRef,
      });

    return buildWalletPermissions({ origin, grants, getAccounts });
  },
};
