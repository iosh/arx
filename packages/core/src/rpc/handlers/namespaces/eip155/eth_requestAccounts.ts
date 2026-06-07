import { ApprovalRejectedError } from "../../../../approvals/errors.js";
import { ApprovalKinds } from "../../../../approvals/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { isDomainError, isRpcError } from "../utils.js";
import { defineEip155NoParamsApprovalMethod, requestProviderApproval } from "./shared.js";

export const ethRequestAccountsDefinition = defineEip155NoParamsApprovalMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  handler: async ({ deps, executionContext, invocation }) => {
    const chainRef = invocation.chainRef;
    const suggested = deps.accounts
      .listOwnedForNamespace({ namespace: invocation.namespace, chainRef })
      .map((account) => account.displayAddress);

    try {
      const approval = await requestProviderApproval({
        deps,
        executionContext,
        method: "eth_requestAccounts",
        kind: ApprovalKinds.RequestAccounts,
        request: {
          chainRef,
          suggestedAccounts: [...suggested],
        },
      });
      return await approval.settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw new ApprovalRejectedError({
        message: "User rejected account access",
        cause: error,
      });
    }
  },
});
