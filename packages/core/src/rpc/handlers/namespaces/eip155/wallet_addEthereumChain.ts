import { ZodError } from "zod";
import { ApprovalKinds } from "../../../../approvals/index.js";
import { ChainNotCompatibleError, ChainNotSupportedError } from "../../../../chains/errors.js";
import {
  type ChainMetadata,
  createEip155MetadataFromEip3085,
  isSameAddChainComparableMetadata,
} from "../../../../chains/index.js";
import { RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizationRequirements, AuthorizedScopeChecks } from "../../types.js";
import { toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requestProviderApproval } from "./shared.js";

export const walletAddEthereumChainDefinition = defineEip155ApprovalMethod<ChainMetadata>({
  requestKind: RpcRequestKinds.ChainManagement,
  authorizationRequirement: AuthorizationRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => {
    const [raw] = toParamsArray(params);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new RpcInvalidParamsError({
        message: "wallet_addEthereumChain expects a single object parameter",
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
      throw new RpcInvalidParamsError({
        message,
        details: {
          expected: "EIP-3085 chain metadata",
        },
        cause: error,
      });
    }
  },
  handler: async ({ params: metadata, deps, executionContext }) => {
    if (metadata.namespace !== "eip155") {
      throw new ChainNotCompatibleError({
        message: "Requested chain is not compatible with wallet_addEthereumChain",
      });
    }

    const existing = deps.supportedChains?.getChain(metadata.chainRef) ?? null;
    if (existing && existing.namespace !== "eip155") {
      throw new ChainNotCompatibleError({
        message: "Requested chain conflicts with an existing non-EVM chain",
      });
    }

    if (existing?.source === "builtin") {
      if (isSameAddChainComparableMetadata(existing.metadata, metadata)) {
        return null;
      }

      throw new ChainNotSupportedError({
        message: "Requested chain conflicts with a builtin chain definition",
      });
    }

    const isUpdate = existing?.source === "custom";

    if (existing && isSameAddChainComparableMetadata(existing.metadata, metadata)) {
      return null;
    }

    const approval = await requestProviderApproval({
      deps,
      executionContext,
      method: "wallet_addEthereumChain",
      kind: ApprovalKinds.AddChain,
      request: {
        metadata,
        isUpdate,
      },
    });
    await approval.settled;

    return null;
  },
});
