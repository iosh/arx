import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds, PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createApprovalId, isDomainError, isRpcError, parseTypedDataParams, toParamsArray } from "../utils.js";
import { assertPermittedEip155Account, requireApprovalRequester } from "./shared.js";

type EthSignTypedDataV4Params = { address: string; typedData: string };

export const ethSignTypedDataV4Definition: MethodDefinition<EthSignTypedDataV4Params> = {
  capability: PermissionCapabilities.Sign,
  permissionCheck: PermissionChecks.Connected,
  locked: lockedQueue(),
  parseParams: (params) => parseTypedDataParams(toParamsArray(params)),
  handler: async ({ origin, params, controllers, services, rpcContext, invocation }) => {
    const { address, typedData } = params;
    const chainRef = invocation.chainRef;
    const from = assertPermittedEip155Account({
      origin,
      method: "eth_signTypedData_v4",
      chainRef,
      address,
      controllers: {
        permissionViews: services.permissionViews,
        chainAddressCodecs: controllers.chainAddressCodecs,
      },
    });

    const request = {
      id: createApprovalId("eth_signTypedData_v4"),
      kind: ApprovalKinds.SignTypedData,
      origin,
      namespace: invocation.namespace,
      chainRef,
      createdAt: controllers.clock.now(),
      request: {
        chainRef,
        from,
        typedData,
      },
    };

    try {
      return await controllers.approvals.create(request, requireApprovalRequester(rpcContext, "eth_signTypedData_v4"))
        .settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: "Failed to sign typed data",
        data: { origin },
        cause: error,
      });
    }
  },
};
