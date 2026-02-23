import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalTypes, PermissionCapabilities } from "../../../../controllers/index.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, deriveSigningInputs, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

type PersonalSignParams = { address: string; message: string };

export const personalSignDefinition: MethodDefinition<PersonalSignParams> = {
  scope: PermissionCapabilities.Sign,
  permissionCheck: PermissionChecks.Connected,
  approvalRequired: true,
  parseParams: (params) => {
    const paramsArray = toParamsArray(params);
    if (paramsArray.length < 2) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "personal_sign requires message and account parameters",
        data: { params },
      });
    }

    const { address, message } = deriveSigningInputs(paramsArray);

    if (!address) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "personal_sign expects an account address parameter",
        data: { params },
      });
    }

    if (!message) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "personal_sign expects a message parameter",
        data: { params },
      });
    }

    return { address, message };
  },
  handler: async ({ origin, params, controllers, rpcContext }) => {
    const { address, message } = params;
    const activeChain = controllers.network.getActiveChain();

    const task = {
      id: createTaskId("personal_sign"),
      type: ApprovalTypes.SignMessage,
      origin,
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      createdAt: Date.now(),
      payload: {
        chainRef: activeChain.chainRef,
        from: address,
        message,
      },
    };

    try {
      const signature = await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "personal_sign"),
      );

      // Grant Sign permission after successful signature
      await controllers.permissions.grant(origin, PermissionCapabilities.Sign, {
        namespace: "eip155",
        chainRef: activeChain.chainRef,
      });

      return signature;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.ApprovalRejected,
        message: "User rejected message signing",
        data: { origin },
        cause: error,
      });
    }
  },
};
