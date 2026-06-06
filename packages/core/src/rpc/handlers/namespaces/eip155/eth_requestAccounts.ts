import { ArxReasons, arxError } from "@arx/errors";
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
  handler: async ({ origin, deps, executionContext, invocation }) => {
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
      throw arxError({
        reason: ArxReasons.ApprovalRejected,
        message: "User rejected account access",
        data: { origin },
        cause: error,
      });
    }
  },
});
