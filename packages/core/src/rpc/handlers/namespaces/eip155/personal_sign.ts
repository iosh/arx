import { ApprovalKinds } from "../../../../approvals/queue/types.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requestProviderApproval } from "./shared.js";
import { parseEip155PersonalSignParams } from "./signingParams.js";

type PersonalSignParams = { address: string; message: string };

export const personalSignDefinition = defineEip155AuthorizedAccountApprovalMethod<
  PersonalSignParams,
  { message: string }
>({
  requestKind: RpcRequestKinds.MessageSigning,
  locked: lockedQueue(),
  parseParams: (params) => {
    const paramsArray = toParamsArray(params);
    if (paramsArray.length < 2) {
      throw new RpcInvalidParamsError({
        message: "personal_sign requires message and account parameters",
      });
    }

    const { address, message } = parseEip155PersonalSignParams(paramsArray);

    if (!address) {
      throw new RpcInvalidParamsError({
        message: "personal_sign expects an account address parameter",
      });
    }

    if (!message) {
      throw new RpcInvalidParamsError({
        message: "personal_sign expects a message parameter",
      });
    }

    return { address, message };
  },
  buildAuthorizedExecution: ({ params }) => {
    return {
      address: params.address,
      prepared: {
        message: params.message,
      },
    };
  },
  executeAuthorizedRequest: async ({ prepared, account, deps, executionContext, invocation }) => {
    const { message } = prepared;
    const chainRef = invocation.chainRef;
    try {
      const approval = await requestProviderApproval({
        deps,
        executionContext,
        method: "personal_sign",
        kind: ApprovalKinds.SignMessage,
        chainRef,
        request: {
          chainRef,
          from: account.canonicalAddress,
          message,
        },
      });
      await approval.settled;
      return await deps.namespaceRuntime.approvals.signMessage({
        chainRef,
        address: account.canonicalAddress,
        message,
      });
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw new RpcInternalError({
        message: "Failed to sign personal message",
        cause: error,
      });
    }
  },
});
