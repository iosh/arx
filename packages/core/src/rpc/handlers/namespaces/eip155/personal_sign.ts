import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../../../controllers/index.js";
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
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "personal_sign requires message and account parameters",
        data: { params },
      });
    }

    const { address, message } = parseEip155PersonalSignParams(paramsArray);

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
  buildAuthorizedExecution: ({ params }) => {
    return {
      address: params.address,
      prepared: {
        message: params.message,
      },
    };
  },
  executeAuthorizedRequest: async ({ origin, prepared, from, controllers, rpcContext, invocation }) => {
    const { message } = prepared;
    const chainRef = invocation.chainRef;
    try {
      return await requestProviderApproval({
        controllers,
        rpcContext,
        method: "personal_sign",
        kind: ApprovalKinds.SignMessage,
        request: {
          chainRef,
          from,
          message,
        },
      }).settled;
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
});
