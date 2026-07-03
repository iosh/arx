import { formatChainAddress } from "../../../../chains/addressing.js";
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
  handler: ({ origin, deps, invocation }) => {
    const chainRef = invocation.chainRef;
    return deps.permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) => formatChainAddress(deps.chainAddressing, { chainRef, canonical: account.canonicalAddress }));
  },
});
