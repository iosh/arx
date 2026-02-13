import type { ChainRef } from "../../../../chains/ids.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import { buildWalletPermissions } from "../../../permissions.js";
import { lockedAllow } from "../../locked.js";
import { NoParamsSchema } from "../../params.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { EIP155_NAMESPACE } from "../utils.js";

export const walletGetPermissionsDefinition: MethodDefinition<undefined> = {
  scope: PermissionScopes.Basic,
  permissionCheck: PermissionChecks.None,
  locked: lockedAllow(),
  paramsSchema: NoParamsSchema,
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
