import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalTypes, PermissionScopes } from "../../../../controllers/index.js";
import type { MethodDefinition } from "../../types.js";
import { createTaskId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

export const ethRequestAccountsDefinition: MethodDefinition = {
  scope: PermissionScopes.Accounts,
  approvalRequired: true,
  isBootstrap: true,
  validateParams: (params) => {
    const arr = toParamsArray(params);
    if (arr.length !== 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_requestAccounts does not accept parameters",
        data: { params },
      });
    }
  },
  handler: async ({ origin, controllers, rpcContext }) => {
    const activeChain = controllers.network.getActiveChain();
    const suggested = controllers.accounts.getAccounts({ chainRef: activeChain.chainRef });

    const task = {
      id: createTaskId("eth_requestAccounts"),
      type: ApprovalTypes.RequestAccounts,
      origin,
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      createdAt: Date.now(),
      payload: {
        chainRef: activeChain.chainRef,
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
};
