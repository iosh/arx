import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestClassifications } from "../../../requestClassification.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizedScopeChecks, ConnectionRequirements } from "../../types.js";
import { createApprovalId, isDomainError, isRpcError } from "../utils.js";
import { defineEip155NoParamsApprovalMethod, requireApprovalRequester } from "./shared.js";

export const ethRequestAccountsDefinition = defineEip155NoParamsApprovalMethod({
  requestClassification: RpcRequestClassifications.AccountsAccess,
  connectionRequirement: ConnectionRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  handler: async ({ origin, controllers, rpcContext, invocation }) => {
    const chainRef = invocation.chainRef;
    const suggested = controllers.accounts
      .listOwnedForNamespace({ namespace: invocation.namespace, chainRef })
      .map((account) => account.displayAddress);

    const request = {
      id: createApprovalId("eth_requestAccounts"),
      kind: ApprovalKinds.RequestAccounts,
      origin,
      namespace: invocation.namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      request: {
        chainRef,
        suggestedAccounts: [...suggested],
      },
    };

    try {
      return await controllers.approvals.create(request, requireApprovalRequester(rpcContext, "eth_requestAccounts"))
        .settled;
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
