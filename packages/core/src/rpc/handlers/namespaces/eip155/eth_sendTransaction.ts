import { ArxReasons, arxError } from "@arx/errors";
import { PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { buildEip155TransactionRequest, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import {
  assertPermittedEip155Account,
  isTransactionResolutionError,
  requireRequestContext,
  TransactionResolutionError,
  waitForTransactionBroadcast,
} from "./shared.js";

type RpcLikeError = Error & { code: number; data?: unknown };

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

export const ethSendTransactionDefinition: MethodDefinition<EthSendTransactionParams> = {
  capability: PermissionCapabilities.SendTransaction,
  permissionCheck: PermissionChecks.Connected,
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
  handler: async ({ origin, params, controllers, rpcContext, invocation }) => {
    const chainRef = invocation.chainRef;

    const txRequest = buildEip155TransactionRequest(params, chainRef);
    const from = assertPermittedEip155Account({
      origin,
      method: "eth_sendTransaction",
      chainRef,
      address: txRequest.payload.from,
      controllers,
    });
    txRequest.payload.from = from;

    try {
      const meta = await controllers.transactions.requestTransactionApproval(
        origin,
        txRequest,
        requireRequestContext(rpcContext, "eth_sendTransaction"),
      );
      const broadcastMeta = await waitForTransactionBroadcast(controllers.transactions, meta.id);

      if (typeof broadcastMeta.hash !== "string") {
        throw new TransactionResolutionError(broadcastMeta);
      }

      await controllers.permissions.grant(origin, PermissionCapabilities.SendTransaction, {
        namespace: broadcastMeta.namespace,
        chainRef: broadcastMeta.chainRef,
      });

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
};
