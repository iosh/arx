import { buildEip2255Permissions } from "../../../../permissions/eip2255.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedAllow } from "../../locked.js";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
  defineNoParamsMethod,
} from "../../types.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  authorizationRequirement: AuthorizationRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedAllow(),
  handler: ({ origin, deps, invocation }) => {
    const snapshot = deps.permissionViews.getAuthorizationSnapshot(origin, {
      chainRef: invocation.chainRef,
    });

    return buildEip2255Permissions({
      origin,
      accountAddresses: snapshot.accounts.map((account) => account.canonicalAddress),
    });
  },
});
