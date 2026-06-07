import { ZodError, z } from "zod";
import { isArxBaseError } from "../../../../error.js";
import { RpcInvalidParamsError } from "../../../errors.js";
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
    throw new RpcInvalidParamsError({
      message: "wallet_switchEthereumChain expects chainId to be a hex string",
      details: {
        field: "chainId",
        expected: "hex string",
      },
    });
  }

  const rawChainId = payload.chainId.trim();

  if (!rawChainId) {
    throw new RpcInvalidParamsError({
      message: "wallet_switchEthereumChain requires a chainId value",
      details: {
        field: "chainId",
        expected: "non-empty hex string",
      },
    });
  }

  if (rawChainId && !HEX_CHAIN_ID_PATTERN.test(rawChainId)) {
    throw new RpcInvalidParamsError({
      message: "wallet_switchEthereumChain received an invalid hex chainId",
      details: {
        field: "chainId",
        expected: "hex string",
      },
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
    if (isArxBaseError(error)) {
      throw error;
    }

    if (error instanceof ZodError) {
      throw new RpcInvalidParamsError({
        message: "wallet_switchEthereumChain expects a single object parameter with chainId",
        cause: error,
      });
    }

    throw error;
  }
};
