import { RpcRequestClassifications } from "../../../requestClassification.js";
import { lockedAllow } from "../../locked.js";
import {
  ApprovalRequirements,
  AuthorizedScopeChecks,
  ConnectionRequirements,
  defineNoParamsMethod,
} from "../../types.js";

export const walletGetPermissionsDefinition = defineNoParamsMethod({
  requestClassification: RpcRequestClassifications.AccountsAccess,
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
