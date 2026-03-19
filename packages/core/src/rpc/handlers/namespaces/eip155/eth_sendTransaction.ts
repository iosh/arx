import { ArxReasons, arxError } from "@arx/errors";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";
import {
  defineEip155AuthorizedAccountApprovalMethod,
  isTransactionResolutionError,
  requireRequestContext,
  TransactionResolutionError,
  waitForTransactionBroadcast,
} from "./shared.js";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

type RpcLikeError = Error & { code: number; data?: unknown };

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

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
      const meta = await controllers.transactions.requestTransactionApproval(
        origin,
        prepared,
        requireRequestContext(rpcContext, "eth_sendTransaction"),
      );
      const broadcastMeta = await waitForTransactionBroadcast(controllers.transactions, meta.id);

      if (typeof broadcastMeta.hash !== "string") {
        throw new TransactionResolutionError(broadcastMeta);
      }

      return broadcastMeta.hash;
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) {
        throw error;
      }

      if (isTransactionResolutionError(error)) {
        const failedMeta = error.meta;

        if (failedMeta.userRejected) {
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
