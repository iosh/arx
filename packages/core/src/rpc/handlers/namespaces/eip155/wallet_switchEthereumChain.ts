import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import { parseChainRef } from "../../../../chains/caip.js";
import { ApprovalKinds } from "../../../../controllers/index.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { AuthorizedScopeChecks, ConnectionRequirements } from "../../types.js";
import { createApprovalId, isDomainError, isRpcError, toParamsArray } from "../utils.js";
import { defineEip155ApprovalMethod, requireApprovalRequester } from "./shared.js";

type WalletSwitchEthereumChainParams = {
  chainId?: string;
  chainRef?: string;
  normalizedChainId?: string;
};

type WalletSwitchEthereumChainPayload = {
  chainId?: unknown;
  chainRef?: unknown;
};

const HEX_CHAIN_ID_PATTERN = /^0x[0-9a-f]+$/i;

const normalizeWalletSwitchEthereumChainParams = (
  payload: WalletSwitchEthereumChainPayload,
): WalletSwitchEthereumChainParams => {
  if (payload.chainId !== undefined && typeof payload.chainId !== "string") {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain expects chainId to be a hex string",
      data: { chainId: payload.chainId },
    });
  }

  if (payload.chainRef !== undefined && typeof payload.chainRef !== "string") {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain expects chainRef to be a string",
      data: { chainRef: payload.chainRef },
    });
  }

  const rawChainId = typeof payload.chainId === "string" ? payload.chainId.trim() : undefined;
  const rawChainRef = typeof payload.chainRef === "string" ? payload.chainRef.trim() : undefined;

  if (!rawChainId && !rawChainRef) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain requires a chainId or chainRef value",
      data: { payload },
    });
  }

  if (rawChainId && !HEX_CHAIN_ID_PATTERN.test(rawChainId)) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain received an invalid hex chainId",
      data: { chainId: rawChainId },
    });
  }

  return {
    ...(rawChainId ? { chainId: rawChainId, normalizedChainId: rawChainId.toLowerCase() } : {}),
    ...(rawChainRef ? { chainRef: rawChainRef } : {}),
  };
};

const WalletSwitchEthereumChainParamsSchema = z
  .any()
  .transform((params): unknown => toParamsArray(params)[0])
  .pipe(
    z.looseObject({
      chainId: z.unknown().optional(),
      chainRef: z.unknown().optional(),
    }),
  )
  .transform(normalizeWalletSwitchEthereumChainParams);

export const walletSwitchEthereumChainDefinition = defineEip155ApprovalMethod<WalletSwitchEthereumChainParams>({
  requestKind: RpcRequestKinds.ChainManagement,
  connectionRequirement: ConnectionRequirements.None,
  authorizedScopeCheck: AuthorizedScopeChecks.None,
  locked: lockedQueue(),
  parseParams: (params) => {
    try {
      return WalletSwitchEthereumChainParamsSchema.parse(params);
    } catch (error) {
      if (isArxError(error)) throw error;
      if (error instanceof ZodError) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "wallet_switchEthereumChain expects a single object parameter",
          data: { params },
          cause: error,
        });
      }
      throw error;
    }
  },
  handler: async ({ origin, params, controllers, services, rpcContext, invocation }) => {
    const rawChainId = params.chainId;
    const rawChainRef = params.chainRef;
    const normalizedChainId = params.normalizedChainId;

    let normalizedChainRef: string | undefined;
    if (rawChainRef) {
      try {
        const parsed = parseChainRef(rawChainRef);
        if (parsed.namespace !== "eip155") {
          throw arxError({
            reason: ArxReasons.ChainNotCompatible,
            message: "Requested chain is not compatible with wallet_switchEthereumChain",
            data: { chainRef: rawChainRef },
          });
        }
        if (normalizedChainId) {
          const decimal = BigInt(normalizedChainId).toString(10);
          if (decimal !== parsed.reference) {
            throw arxError({
              reason: ArxReasons.RpcInvalidParams,
              message: "wallet_switchEthereumChain chainId does not match chainRef reference",
              data: { chainId: rawChainId, chainRef: rawChainRef },
            });
          }
        }
        normalizedChainRef = `${parsed.namespace}:${parsed.reference}`;
      } catch (error) {
        if (isDomainError(error) || isRpcError(error)) throw error;
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: "wallet_switchEthereumChain received an invalid chainRef identifier",
          data: { chainRef: rawChainRef },
          cause: error,
        });
      }
    }

    const target = services.chainViews.resolveEip155SwitchChain({
      ...(normalizedChainId ? { chainId: normalizedChainId } : {}),
      ...(normalizedChainRef ? { chainRef: normalizedChainRef } : {}),
    });

    if (invocation.chainRef === target.chainRef) {
      return null;
    }

    const request = {
      id: createApprovalId("wallet_switchEthereumChain"),
      kind: ApprovalKinds.SwitchChain,
      origin,
      namespace: invocation.namespace,
      chainRef: target.chainRef,
      createdAt: controllers.clock.now(),
      request: {
        chainRef: target.chainRef,
      },
    };

    return await controllers.approvals.create(
      request,
      requireApprovalRequester(rpcContext, "wallet_switchEthereumChain"),
    ).settled;
  },
});
