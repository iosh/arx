import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { ZodError, z } from "zod";
import { toParamsArray } from "../utils.js";

export type WalletSwitchEthereumChainParams = {
  chainId: string;
};

type WalletSwitchEthereumChainPayload = {
  chainId?: unknown;
};

const HEX_CHAIN_ID_PATTERN = /^0x[0-9a-f]+$/i;

const parseWalletSwitchEthereumChainPayload = (
  payload: WalletSwitchEthereumChainPayload,
): WalletSwitchEthereumChainParams => {
  if (typeof payload.chainId !== "string") {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain expects chainId to be a hex string",
      data: { chainId: payload.chainId },
    });
  }

  const rawChainId = payload.chainId.trim();

  if (!rawChainId) {
    throw arxError({
      reason: ArxReasons.RpcInvalidParams,
      message: "wallet_switchEthereumChain requires a chainId value",
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
    chainId: rawChainId.toLowerCase(),
  };
};

export const WalletSwitchEthereumChainParamsSchema = z
  .any()
  .transform((params): unknown => toParamsArray(params)[0])
  .pipe(z.strictObject({ chainId: z.unknown() }))
  .transform(parseWalletSwitchEthereumChainPayload);

export const parseWalletSwitchEthereumChainParams = (params: unknown): WalletSwitchEthereumChainParams => {
  try {
    return WalletSwitchEthereumChainParamsSchema.parse(params);
  } catch (error) {
    if (isArxError(error)) {
      throw error;
    }

    if (error instanceof ZodError) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "wallet_switchEthereumChain expects a single object parameter with chainId",
        data: { params },
        cause: error,
      });
    }

    throw error;
  }
};
