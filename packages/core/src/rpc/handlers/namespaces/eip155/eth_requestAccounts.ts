import { ApprovalRejectedError } from "../../../../approvals/errors.js";
import { ApprovalKinds } from "../../../../approvals/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { isDomainError, isRpcError } from "../utils.js";
import { grantAccountsForConnectionApproval } from "./connectionPermissions.js";
import { defineEip155NoParamsApprovalMethod, requestProviderApproval } from "./shared.js";

export const ethRequestAccountsDefinition = defineEip155NoParamsApprovalMethod({
  requestKind: RpcRequestKinds.AccountAccess,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  handler: async (context) => {
    const { deps, executionContext, invocation } = context;
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
        chainRef,
        request: {
          chainRef,
          suggestedAccounts: [...suggested],
        },
      });
      const decision = await approval.settled;

      const approvalRecord = {
        approvalId: approval.approvalId,
        kind: ApprovalKinds.RequestAccounts,
        origin: context.origin,
        namespace: invocation.namespace,
        chainRef,
      };
      const { selectedAccounts } = await grantAccountsForConnectionApproval({
        approval: approvalRecord,
        decision,
        selectionChainRef: chainRef,
        authorizedChainRefs: [chainRef],
        deps,
      });

      return selectedAccounts.map((account) => account.displayAddress);
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw new ApprovalRejectedError({
        message: "User rejected account access",
        cause: error,
      });
    }
  },
});
