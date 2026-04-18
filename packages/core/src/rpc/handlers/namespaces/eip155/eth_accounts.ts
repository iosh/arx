import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedResponse } from "../../locked.js";
import {
  ApprovalRequirements,
  AuthorizationRequirements,
  AuthorizedScopeChecks,
  defineNoParamsMethod,
} from "../../types.js";

export const ethAccountsDefinition = defineNoParamsMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  authorizationRequirement: AuthorizationRequirements.None,
  approvalRequirement: ApprovalRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedResponse([]),
  handler: ({ origin, controllers, services, invocation }) => {
    const chainRef = invocation.chainRef;
    return services.permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) =>
        controllers.chainAddressCodecs.formatAddress({ chainRef, canonical: account.canonicalAddress }),
      );
  },
});
