import { ArxReasons, arxError } from "@arx/errors";
import { ZodError } from "zod";
import {
  type ChainMetadata,
  createEip155MetadataFromEip3085,
  isSameAddChainComparableMetadata,
} from "../../../../chains/index.js";
import { ApprovalTypes, PermissionCapabilities } from "../../../../controllers/index.js";
import { lockedQueue } from "../../locked.js";
import { type MethodDefinition, PermissionChecks } from "../../types.js";
import { createTaskId, toParamsArray } from "../utils.js";
import { requireRequestContext } from "./shared.js";

export const walletAddEthereumChainDefinition: MethodDefinition<ChainMetadata> = {
  capability: PermissionCapabilities.Basic,
  // Require an existing connection so unrelated pages cannot spam chain addition prompts.
  // User still approves the addition explicitly via the approval flow.
  permissionCheck: PermissionChecks.Connected,
  locked: lockedQueue(),
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
        data: { params, ...(error instanceof ZodError ? { issues: error.issues } : {}) },
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

    const existing = controllers.chainDefinitions.getChain(metadata.chainRef);
    if (existing && existing.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain conflicts with an existing non-EVM chain",
        data: { chainRef: metadata.chainRef },
      });
    }
    const isUpdate = Boolean(existing);

    // If the chain already exists and the request does not change anything, treat as a no-op.
    // This avoids repeated approval prompts for idempotent wallet_addEthereumChain calls.
    if (existing && isSameAddChainComparableMetadata(existing.metadata, metadata)) {
      return null;
    }

    const task = {
      id: createTaskId("wallet_addEthereumChain"),
      type: ApprovalTypes.AddChain,
      origin,
      namespace: metadata.namespace,
      chainRef: metadata.chainRef,
      createdAt: controllers.clock.now(),
      payload: {
        metadata,
        isUpdate,
      },
    };

    await controllers.approvals.requestApproval(task, requireRequestContext(rpcContext, "wallet_addEthereumChain"));

    return null;
  },
};
