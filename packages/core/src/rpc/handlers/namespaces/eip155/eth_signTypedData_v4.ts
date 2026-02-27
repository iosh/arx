import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalTypes, PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, isDomainError, isRpcError, parseTypedDataParams, toParamsArray } from "../utils.js";
import { assertPermittedEip155Account, requireRequestContext } from "./shared.js";

type EthSignTypedDataV4Params = { address: string; typedData: string };

export const ethSignTypedDataV4Definition: MethodDefinition<EthSignTypedDataV4Params> = {
  capability: PermissionCapabilities.Sign,
  permissionCheck: PermissionChecks.Connected,
  locked: lockedQueue(),
  parseParams: (params) => parseTypedDataParams(toParamsArray(params)),
  handler: async ({ origin, params, controllers, rpcContext, invocation }) => {
    const { address, typedData } = params;
    const chainRef = invocation.chainRef;
    const from = assertPermittedEip155Account({
      origin,
      method: "eth_signTypedData_v4",
      chainRef,
      address,
      controllers,
    });

    const task = {
      id: createTaskId("eth_signTypedData_v4"),
      type: ApprovalTypes.SignTypedData,
      origin,
      namespace: invocation.namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      payload: {
        chainRef,
        from,
        typedData,
      },
    };

    try {
      const signature = await controllers.approvals.requestApproval(
        task,
        requireRequestContext(rpcContext, "eth_signTypedData_v4"),
      );

      // Grant Sign permission after successful signature
      await controllers.permissions.grant(origin, PermissionCapabilities.Sign, {
        namespace: invocation.namespace,
        chainRef,
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
