import { ArxReasons, arxError } from "@arx/errors";
import { requestApproval } from "../../../../approvals/creation.js";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requireRequestContext } from "./shared.js";
import { parseEip155TypedDataParams } from "./signingParams.js";

type EthSignTypedDataV4Params = { address: string; typedData: string };

export const ethSignTypedDataV4Definition = defineEip155AuthorizedAccountApprovalMethod<
  EthSignTypedDataV4Params,
  { typedData: string }
>({
  requestKind: RpcRequestKinds.MessageSigning,
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
    try {
      return await requestApproval(
        {
          approvals: controllers.approvals,
          now: controllers.clock.now,
        },
        {
          kind: ApprovalKinds.SignTypedData,
          requestContext: requireRequestContext(rpcContext, "eth_signTypedData_v4"),
          request: {
            chainRef,
            from,
            typedData,
          },
        },
      ).settled;
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
