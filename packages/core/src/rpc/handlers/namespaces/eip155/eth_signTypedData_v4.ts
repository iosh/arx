import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalTypes, PermissionScopes } from "../../../../controllers/index.js";
import type { MethodDefinition } from "../../types.js";
import { createTaskId, isDomainError, isRpcError, parseTypedDataParams, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

export const ethSignTypedDataV4Definition: MethodDefinition = {
  scope: PermissionScopes.Sign,
  approvalRequired: true,
  validateParams: (params) => {
    parseTypedDataParams(toParamsArray(params));
  },
  handler: async ({ origin, request, controllers, rpcContext }) => {
    const paramsArray = toParamsArray(request.params);

    if (paramsArray.length < 2) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_signTypedData_v4 requires address and typed data parameters",
        data: { params: request.params },
      });
    }

    const { address, typedData } = parseTypedDataParams(paramsArray);
    const activeChain = controllers.network.getActiveChain();

    const task = {
      id: createTaskId("eth_signTypedData_v4"),
      type: ApprovalTypes.SignTypedData,
      origin,
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      createdAt: Date.now(),
      payload: {
        chainRef: activeChain.chainRef,
        from: address,
        typedData,
      },
    };

    try {
      const signature = await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "eth_signTypedData_v4"),
      );

      // Grant Sign permission after successful signature
      await controllers.permissions.grant(origin, PermissionScopes.Sign, {
        namespace: "eip155",
        chainRef: activeChain.chainRef,
      });

      return signature;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.ApprovalRejected,
        message: "User rejected typed data signing",
        data: { origin },
        cause: error,
      });
    }
  },
};
