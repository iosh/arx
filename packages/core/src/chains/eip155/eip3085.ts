import { z } from "zod";
import { chainRefFromChainId } from "../../namespaces/eip155/chainId.js";
import type { ChainDefinition, CustomNetworkInput } from "../../networks/types.js";
import * as Hex from "../../utils/hex.js";
import { ChainDefinitionRpcUrlsRequiredError } from "../errors.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols } from "../url.js";

const trimmed = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const rpcUrl = z.url().refine((url) => isUrlWithProtocols(url, HTTP_PROTOCOLS), {
  message: "URL must use http or https protocol",
});

const httpUrl = z.url().refine((url) => isUrlWithProtocols(url, HTTP_PROTOCOLS), {
  message: "URL must use http or https protocol",
});

const eip3085Schema = z.object({
  chainId: trimmed(),
  chainName: trimmed(),
  nativeCurrency: z.object({
    name: trimmed(),
    symbol: trimmed(),
    decimals: z.number().int().nonnegative(),
  }),
  rpcUrls: z.array(rpcUrl).min(1),
  blockExplorerUrls: z.preprocess((value) => (value === null ? undefined : value), z.array(httpUrl).optional()),
});

const dedupe = (values: readonly string[]) => Array.from(new Set(values.map((value) => value.trim())));

export const createEip155DefinitionSeedFromEip3085 = (input: unknown): CustomNetworkInput => {
  const payload = eip3085Schema.parse(input);

  const chainRef = chainRefFromChainId(Hex.toBigInt(payload.chainId));

  const rpcUrls = dedupe(payload.rpcUrls).filter(Boolean);
  const firstRpcUrl = rpcUrls[0];
  if (!firstRpcUrl) {
    throw new ChainDefinitionRpcUrlsRequiredError(chainRef);
  }

  const explorers = payload.blockExplorerUrls ? dedupe(payload.blockExplorerUrls).map((url) => ({ url })) : undefined;

  const definition: ChainDefinition = {
    chainRef,
    name: payload.chainName,
    nativeCurrency: payload.nativeCurrency,
    ...(explorers ? { blockExplorers: explorers } : {}),
  };

  return {
    definition,
    defaultRpcEndpoints: [firstRpcUrl, ...rpcUrls.slice(1)],
  };
};
