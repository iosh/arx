import { ApprovalKinds } from "../../../../approvals/index.js";
import { RpcInternalError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requestProviderApproval } from "./shared.js";
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
  executeAuthorizedRequest: async ({ prepared, account, deps, executionContext, invocation }) => {
    const { typedData } = prepared;
    const chainRef = invocation.chainRef;
    try {
      const approval = await requestProviderApproval({
        deps,
        executionContext,
        method: "eth_signTypedData_v4",
        kind: ApprovalKinds.SignTypedData,
        request: {
          chainRef,
          from: account.canonicalAddress,
          typedData,
        },
      });
      return await approval.settled;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw new RpcInternalError({
        message: "Failed to sign typed data",
        cause: error,
      });
    }
  },
});
