import { z } from "zod";
import type { CustomNetworkInput, NonEmptyRpcEndpoints } from "../../networks/types.js";
import { chainRefFromChainId } from "./chainId.js";
import { chainIdParam } from "./dappChainId.js";

const trimmed = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const httpsOrLoopbackHttpUrl = z.union(
  [z.url({ protocol: /^https$/ }), z.url({ protocol: /^http$/, hostname: /^(localhost|127\.0\.0\.1|\[::1\])$/ })],
  "Expected an HTTPS URL or a loopback HTTP URL.",
);

const rpcUrls = z.array(z.unknown()).transform((candidates, ctx): NonEmptyRpcEndpoints => {
  for (const candidate of candidates) {
    const parsed = httpsOrLoopbackHttpUrl.safeParse(candidate);
    if (parsed.success) return [parsed.data];
  }

  ctx.addIssue({ code: "custom", message: "Expected at least one HTTPS URL or loopback HTTP URL." });
  return z.NEVER;
});

const ADD_ETHEREUM_CHAIN_PARAMS_SCHEMA = z.tuple([
  z.object({
    chainId: chainIdParam,
    chainName: trimmed(),
    nativeCurrency: z.object({
      name: trimmed(),
      symbol: trimmed(),
      decimals: z.number().int().nonnegative(),
    }),
    rpcUrls,
    blockExplorerUrls: z.array(z.unknown()).nullish(),
  }),
]);

export const decodeAddEthereumChainParams = (params: unknown): CustomNetworkInput => {
  const [payload] = ADD_ETHEREUM_CHAIN_PARAMS_SCHEMA.parse(params);
  const explorerUrls = new Set<string>();
  for (const candidate of payload.blockExplorerUrls ?? []) {
    const parsed = httpsOrLoopbackHttpUrl.safeParse(candidate);
    if (parsed.success) explorerUrls.add(parsed.data);
  }

  return {
    definition: {
      chainRef: chainRefFromChainId(payload.chainId),
      name: payload.chainName,
      nativeCurrency: payload.nativeCurrency,
      ...(explorerUrls.size > 0 ? { blockExplorers: Array.from(explorerUrls, (url) => ({ url })) } : {}),
    },
    defaultRpcEndpoints: payload.rpcUrls,
  };
};
