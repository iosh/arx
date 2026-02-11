import { ArxReasons, arxError } from "@arx/errors";
import type { ChainRef } from "../../../../chains/ids.js";
import { parseChainRef } from "../../../../chains/index.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import type { MethodDefinition } from "../../types.js";
import { buildEip155TransactionRequest, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import {
  isTransactionResolutionError,
  requireRequestContext,
  TransactionResolutionError,
  waitForTransactionBroadcast,
} from "./shared.js";

type RpcLikeError = Error & { code: number; data?: unknown };

export const ethSendTransactionDefinition: MethodDefinition = {
  scope: PermissionScopes.Transaction,
  approvalRequired: true,
  validateParams: (params, rpcContext) => {
    const chainRef = rpcContext?.chainRef;
    if (!chainRef) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: "Missing chainRef for eth_sendTransaction",
        data: { method: "eth_sendTransaction" },
      });
    }
    buildEip155TransactionRequest(toParamsArray(params), chainRef as ChainRef);
  },
  handler: async ({ origin, request, controllers, rpcContext }) => {
    const paramsArray = toParamsArray(request.params);

    if (paramsArray.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "eth_sendTransaction requires at least one transaction parameter",
        data: { params: request.params },
      });
    }

    const activeChain = controllers.network.getActiveChain();
    let chainRef = activeChain.chainRef;

    const ctxChainRef = rpcContext?.chainRef ?? null;
    if (ctxChainRef) {
      try {
        const parsed = parseChainRef(ctxChainRef);
        if (parsed.namespace !== "eip155") {
          throw arxError({
            reason: ArxReasons.ChainNotCompatible,
            message: "Requested chain is not compatible with eth_sendTransaction",
            data: { chainRef: ctxChainRef },
          });
        }
        chainRef = `${parsed.namespace}:${parsed.reference}`;
      } catch (error) {
        if (isDomainError(error) || isRpcError(error)) throw error;
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "eth_sendTransaction received an invalid chainRef identifier",
          data: { chainRef: ctxChainRef },
          cause: error,
        });
      }
    }

    const txRequest = buildEip155TransactionRequest(paramsArray, chainRef);

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

      await controllers.permissions.grant(origin, PermissionScopes.Transaction, {
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
