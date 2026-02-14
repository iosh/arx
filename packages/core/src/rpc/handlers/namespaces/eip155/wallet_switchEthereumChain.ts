import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import { parseChainRef } from "../../../../chains/index.js";
import { PermissionScopes } from "../../../../controllers/index.js";
import type { MethodDefinition } from "../../types.js";
import { isDomainError, isRpcError, toParamsArray } from "../utils.js";

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

  // With `exactOptionalPropertyTypes`, optional fields should be omitted
  // when absent instead of being set to `undefined`.
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

export const walletSwitchEthereumChainDefinition: MethodDefinition<WalletSwitchEthereumChainParams> = {
  scope: PermissionScopes.Basic,
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
  handler: async ({ params, controllers, rpcContext }) => {
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

    const state = controllers.network.getState();
    const target = state.knownChains.find((item) => {
      if (normalizedChainRef && item.chainRef === normalizedChainRef) return true;
      if (normalizedChainId) {
        const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
        if (candidateChainId && candidateChainId === normalizedChainId) return true;
      }
      return false;
    });

    if (!target) {
      throw arxError({
        reason: ArxReasons.ChainNotFound,
        message: "Requested chain is not registered with ARX",
        data: { chainId: rawChainId, chainRef: rawChainRef },
      });
    }

    if (target.namespace !== "eip155") {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: "Requested chain is not compatible with wallet_switchEthereumChain",
        data: { chainRef: target.chainRef },
      });
    }

    const supportsFeature = target.features?.includes("wallet_switchEthereumChain") ?? false;
    if (!supportsFeature) {
      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: "Requested chain does not support wallet_switchEthereumChain",
        data: { chainRef: target.chainRef },
      });
    }

    try {
      await controllers.network.switchChain(target.chainRef);
      return null;
    } catch (error) {
      if (error instanceof Error && /unknown chain/i.test(error.message)) {
        throw arxError({
          reason: ArxReasons.ChainNotFound,
          message: error.message,
          data: { chainId: rawChainId ?? target.chainId, chainRef: normalizedChainRef ?? target.chainRef },
          cause: error,
        });
      }
      if (isArxError(error)) throw error;
      throw arxError({
        reason: ArxReasons.RpcInternal,
        message: error instanceof Error ? error.message : "Failed to switch chain",
        data: { chainRef: target.chainRef },
        cause: error,
      });
    }
  },
};
