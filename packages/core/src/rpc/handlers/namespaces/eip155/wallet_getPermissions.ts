import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedAllow } from "../../locked.js";
import {
  ApprovalRequirements,
  AuthorizedScopeChecks,
  ConnectionRequirements,
  defineNoParamsMethod,
} from "../../types.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  connectionRequirement: ConnectionRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedAllow(),
  handler: ({ origin, services, invocation }) => {
    return services.permissionViews.buildWalletPermissions(origin, {
      namespace: invocation.namespace,
      chainRef: invocation.chainRef,
    });
  },
});
