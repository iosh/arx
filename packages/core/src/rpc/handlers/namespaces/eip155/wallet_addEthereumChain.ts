import { ArxReasons, arxError } from "@arx/errors";
import { ZodError } from "zod";
import { type ChainMetadata, createEip155MetadataFromEip3085 } from "../../../../chains/index.js";
import { ApprovalTypes, PermissionScopes } from "../../../../controllers/index.js";
import type { MethodDefinition } from "../../types.js";
import { createTaskId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

export const walletAddEthereumChainDefinition: MethodDefinition<ChainMetadata> = {
  scope: PermissionScopes.Basic,
  approvalRequired: true,
  parseParams: (params) => {
    const [raw] = toParamsArray(params);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_addEthereumChain expects a single object parameter",
        data: { params },
      });
    }
    try {
      return createEip155MetadataFromEip3085(raw);
    } catch (error) {
      const message =
        error instanceof ZodError
          ? "wallet_addEthereumChain received invalid chain parameters"
          : error instanceof Error
            ? error.message
            : "Invalid chain parameters";
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message,
        data: { params },
        cause: error,
      });
    }
  },
  handler: async ({ origin, params: metadata, controllers, rpcContext }) => {
    if (metadata.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain is not compatible with wallet_addEthereumChain",
        data: { chainRef: metadata.chainRef },
      });
    }

    const existing = controllers.chainRegistry.getChain(metadata.chainRef);
    if (existing && existing.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain conflicts with an existing non-EVM chain",
        data: { chainRef: metadata.chainRef },
      });
    }
    const isUpdate = Boolean(existing);

    const task = {
      id: createTaskId("wallet_addEthereumChain"),
      type: ApprovalTypes.AddChain,
      origin,
      namespace: metadata.namespace,
      chainRef: metadata.chainRef,
      createdAt: Date.now(),
      payload: {
        metadata,
        isUpdate,
      },
    };

    try {
      await controllers.approvals.requestApproval(task, requireRequestContext(rpcContext, "wallet_addEthereumChain"));
    } catch (error) {
      if (isDomainError(error) || isRpcError(error)) throw error;
      throw arxError({
        reason: ArxReasons.ApprovalRejected,
        message: "User rejected chain addition",
        data: { origin },
        cause: error,
      });
    }

    return null;
  },
};
