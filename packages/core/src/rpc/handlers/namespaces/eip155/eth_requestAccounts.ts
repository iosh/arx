import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalTypes, PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { defineNoParamsMethod, PermissionChecks } from "../../types.js";
import { createTaskId, isDomainError, isRpcError } from "../utils.js";
import { requireRequestContext } from "./shared.js";

export const ethRequestAccountsDefinition = defineNoParamsMethod({
  scope: PermissionCapabilities.Accounts,
  permissionCheck: PermissionChecks.None,
  locked: lockedQueue(),
  handler: async ({ origin, controllers, rpcContext, invocation }) => {
    const chainRef = invocation.chainRef;
    const suggested = controllers.accounts.getAccounts({ chainRef });

    const task = {
      id: createTaskId("eth_requestAccounts"),
      type: ApprovalTypes.RequestAccounts,
      origin,
      namespace: invocation.namespace,
      chainRef,
      createdAt: Date.now(),
      payload: {
        chainRef,
        suggestedAccounts: [...suggested],
      },
    };

    try {
      return await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "eth_requestAccounts"),
      );
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
