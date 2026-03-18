import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestClassifications } from "../../../requestClassification.js";
import { lockedQueue } from "../../locked.js";
import { createApprovalId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requireApprovalRequester } from "./shared.js";
import { parseEip155TypedDataParams } from "./signingParams.js";

type EthSignTypedDataV4Params = { address: string; typedData: string };

export const ethSignTypedDataV4Definition = defineEip155AuthorizedAccountApprovalMethod<
  EthSignTypedDataV4Params,
  { typedData: string }
>({
  requestClassification: RpcRequestClassifications.MessageSigning,
  locked: lockedQueue(),
  parseParams: (params) => parseEip155TypedDataParams(toParamsArray(params)),
  buildAuthorizedExecution: ({ params }) => {
    return {
      address: params.address,
      prepared: {
        typedData: params.typedData,
      },
    };
  },
  executeAuthorizedRequest: async ({ origin, prepared, from, controllers, rpcContext, invocation }) => {
    const { typedData } = prepared;
    const chainRef = invocation.chainRef;
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
});
