import { chainIdFromChainRef } from "@arx/core/namespaces";
import {
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkRpcEndpointReadError,
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
        actualChainId: `${chainIdFromChainRef(actualChainRef)}`,
        expectedChainId: `${chainIdFromChainRef(expectedChainRef)}`,
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
