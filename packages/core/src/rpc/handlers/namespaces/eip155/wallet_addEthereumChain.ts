import { ArxReasons, arxError } from "@arx/errors";
import { ZodError } from "zod";
import { requestApproval } from "../../../../approvals/creation.js";
import {
  type ChainMetadata,
  createEip155MetadataFromEip3085,
  isSameAddChainComparableMetadata,
} from "../../../../chains/index.js";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requireRequestContext } from "./shared.js";

export const walletAddEthereumChainDefinition = defineEip155ApprovalMethod<ChainMetadata>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
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
  handler: async ({ origin: _origin, params: metadata, controllers, rpcContext }) => {
    if (metadata.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain is not compatible with wallet_addEthereumChain",
        data: { chainRef: metadata.chainRef },
      });
    }

    const existing = controllers.supportedChains?.getChain(metadata.chainRef) ?? null;
    if (existing && existing.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain conflicts with an existing non-EVM chain",
        data: { chainRef: metadata.chainRef },
      });
    }

    if (existing?.source === "builtin") {
      if (isSameAddChainComparableMetadata(existing.metadata, metadata)) {
        return null;
      }

      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Requested chain conflicts with a builtin chain definition",
        data: { chainRef: metadata.chainRef },
      });
    }

    const isUpdate = existing?.source === "custom";

    if (existing && isSameAddChainComparableMetadata(existing.metadata, metadata)) {
      return null;
    }

    await requestApproval(
      {
        approvals: controllers.approvals,
        now: controllers.clock.now,
      },
      {
        kind: ApprovalKinds.AddChain,
        requestContext: requireRequestContext(rpcContext, "wallet_addEthereumChain"),
        request: {
          metadata,
          isUpdate,
        },
      },
    ).settled;

    return null;
  },
});
