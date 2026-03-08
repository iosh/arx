import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds, PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, deriveSigningInputs, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { assertPermittedEip155Account, requireApprovalRequester } from "./shared.js";

type PersonalSignParams = { address: string; message: string };

export const personalSignDefinition: MethodDefinition<PersonalSignParams> = {
  capability: PermissionCapabilities.Sign,
  permissionCheck: PermissionChecks.Connected,
  locked: lockedQueue(),
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
  handler: async ({ origin, params, controllers, rpcContext, invocation }) => {
    const { address, message } = params;
    const chainRef = invocation.chainRef;
    const from = assertPermittedEip155Account({
      origin,
      method: "personal_sign",
      chainRef,
      address,
      controllers,
    });

    const request = {
      id: createTaskId("personal_sign"),
      kind: ApprovalKinds.SignMessage,
      origin,
      namespace: invocation.namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      request: {
        chainRef,
        from,
        message,
      },
    };

    try {
      return await controllers.approvals.create(request, requireApprovalRequester(rpcContext, "personal_sign")).settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to sign personal message",
        data: { origin },
        cause: error,
      });
    }
  },
};
