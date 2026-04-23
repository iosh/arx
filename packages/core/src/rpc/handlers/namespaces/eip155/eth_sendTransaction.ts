import { ArxReasons, arxError } from "@arx/errors";
import { isTransactionSubmissionError } from "../../../../controllers/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import {
  defineEip155AuthorizedAccountApprovalMethod,
  requireProviderRequestHandle,
  requireRequestContext,
} from "./shared.js";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

type RpcLikeError = Error & { code: number; data?: unknown };

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

const isRejectedBeforeBroadcast = (params: {
  userRejected: boolean;
  error: { code?: number | undefined; name?: string | undefined } | null;
}) => params.userRejected || params.error?.code === 4001 || params.error?.name === "TransactionRejectedError";

export const ethSendTransactionDefinition = defineEip155AuthorizedAccountApprovalMethod({
  requestKind: RpcRequestKinds.TransactionSubmission,
  locked: lockedQueue(),
  parseParams: (params) => {
    const paramsArray = toParamsArray(params);

    if (paramsArray.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_sendTransaction requires at least one transaction parameter",
        data: { params },
      });
    }

    return paramsArray as unknown as EthSendTransactionParams;
  },
  buildAuthorizedExecution: ({ params, invocation }) => {
    const txRequest = buildEip155TransactionRequest(params, invocation.chainRef);
    return {
      address: txRequest.payload.from,
      prepared: txRequest,
    };
  },
  executeAuthorizedRequest: async ({ origin, prepared, from, controllers, rpcContext }) => {
    prepared.payload.from = from;
    try {
      const requestContext = requireRequestContext(rpcContext, "eth_sendTransaction");
      const providerRequestHandle = requireProviderRequestHandle(rpcContext, "eth_sendTransaction");
      const handoff = await controllers.transactions.beginTransactionApproval(prepared, requestContext, {
        providerRequestHandle,
      });
      await handoff.waitForApprovalDecision();
      const submission = await controllers.transactions.waitForTransactionSubmission(handoff.transactionId);
      const submitted = submission.meta.submitted as { hash?: unknown } | null;
      const hash = typeof submitted?.hash === "string" ? submitted.hash : null;
      if (!hash) {
        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: "EIP-155 transaction submission did not return a transaction hash.",
          data: {
            id: handoff.transactionId,
            submitted: submission.meta.submitted,
            locator: submission.locator,
          },
        });
      }
      return hash;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) {
        throw error;
      }

      if (isTransactionSubmissionError(error)) {
        const failedMeta = error.meta;

        if (isRejectedBeforeBroadcast({ userRejected: failedMeta.userRejected, error: failedMeta.error })) {
          throw arxError({
            reason: ArxReasons.ApprovalRejected,
            message: "User rejected transaction",
            data: { origin, id: failedMeta.id },
          });
        }

        const failure = failedMeta.error;
        if (failure && typeof failure.code === "number") {
          const rpcLikeError = new Error(failure.message ?? "Transaction failed") as RpcLikeError;
          rpcLikeError.code = failure.code;
          if (failure.data !== undefined) {
            rpcLikeError.data = failure.data;
          }
          throw rpcLikeError;
        }

        throw arxError({
          reason: ArxReasons.RpcInternal,
          message: failure?.message ?? "Transaction failed to broadcast",
          data: { origin, id: failedMeta.id, error: failure ?? undefined },
        });
      }

      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: error instanceof Error ? error.message : "Transaction submission failed",
        data: { origin },
        cause: error,
      });
    }
  },
});
