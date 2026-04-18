import { buildEip2255PermissionsFromAuthorizationSnapshot } from "../../../permissions.js";
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
  handler: ({ origin, services, invocation }) => {
    return buildEip2255PermissionsFromAuthorizationSnapshot({
      origin,
      snapshot: services.permissionViews.getAuthorizationSnapshot(origin, {
        chainRef: invocation.chainRef,
      }),
    });
  },
});
