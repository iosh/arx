import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestClassifications } from "../../../requestClassification.js";
import { lockedQueue } from "../../locked.js";
import { createApprovalId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requireApprovalRequester } from "./shared.js";
import { parseEip155PersonalSignParams } from "./signingParams.js";

type PersonalSignParams = { address: string; message: string };

export const personalSignDefinition = defineEip155AuthorizedAccountApprovalMethod<
  PersonalSignParams,
  { message: string }
>({
  requestClassification: RpcRequestClassifications.MessageSigning,
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
    const request = {
      id: createApprovalId("personal_sign"),
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
});
