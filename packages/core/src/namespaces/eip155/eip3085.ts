import { z } from "zod";
import { invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import type { CustomNetworkInput, NonEmptyRpcEndpoints } from "../../networks/types.js";
import { decodeChainId } from "./rpcHex.js";

const trimmed = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const httpsOrLoopbackHttpUrl = z.url().refine(
  (value) => {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;

    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  },
  { message: "URL must use HTTPS; HTTP is allowed only for loopback hosts" },
);

const ADD_ETHEREUM_CHAIN_PARAMS_SCHEMA = z.tuple([
  z.object({
    chainId: z.string(),
    chainName: trimmed(),
    nativeCurrency: z.object({
      name: trimmed(),
      symbol: trimmed(),
      decimals: z.number().int().nonnegative(),
    }),
    rpcUrls: z.array(httpsOrLoopbackHttpUrl).min(1),
    blockExplorerUrls: z.array(httpsOrLoopbackHttpUrl).optional(),
    iconUrls: z.array(httpsOrLoopbackHttpUrl).optional(),
  }),
]);

const unique = (values: readonly string[]): string[] => [...new Set(values)];

export const decodeAddEthereumChainParams = (params: unknown, method: string): CustomNetworkInput => {
  const [payload] = ADD_ETHEREUM_CHAIN_PARAMS_SCHEMA.parse(params);
  const { chainRef } = decodeChainId(payload.chainId, method);
  const [firstRpcUrl, ...remainingRpcUrls] = unique(payload.rpcUrls);
  if (!firstRpcUrl) throw invalidDappParams(method, "rpcUrls must contain at least one HTTP or HTTPS URL.");

  const defaultRpcEndpoints: NonEmptyRpcEndpoints = [firstRpcUrl, ...remainingRpcUrls];
  const blockExplorers = payload.blockExplorerUrls
    ? unique(payload.blockExplorerUrls).map((url) => ({ url }))
    : undefined;

  return {
    definition: {
      chainRef,
      name: payload.chainName,
      nativeCurrency: payload.nativeCurrency,
      ...(blockExplorers && blockExplorers.length > 0 ? { blockExplorers } : {}),
    },
    defaultRpcEndpoints,
  };
};
