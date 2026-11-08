import {
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
  parseChainRef,
} from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import type { TFunction } from "i18next";

export function getNetworkRpcError(error: unknown, networkName: string, t: TFunction<"wallet">) {
  if (isWalletApiError(error, NetworkRpcEndpointInvalidError)) {
    const { endpoint } = error.details as { endpoint: string };
    return { endpoint, message: t("rpcUrlInvalid") };
  }
  if (isWalletApiError(error, NetworkRpcEndpointMismatchError)) {
    const { endpoint, actualChainRef, expectedChainRef } = error.details as ConstructorParameters<
      typeof NetworkRpcEndpointMismatchError
    >[0];
    return {
      endpoint,
      message: t("rpcChainMismatch", {
        actualChainId: parseChainRef(actualChainRef).reference,
        expectedChainId: parseChainRef(expectedChainRef).reference,
        networkName,
      }),
    };
  }
  if (isWalletApiError(error, NetworkRpcEndpointReadError)) {
    const { endpoint } = error.details as { endpoint: string };
    return { endpoint, message: t("rpcReadFailed") };
  }
  return null;
}
