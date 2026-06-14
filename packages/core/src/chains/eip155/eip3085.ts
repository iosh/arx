import { z } from "zod";
import * as Hex from "../../utils/hex.js";
import type { ChainDefinitionSeed } from "../definition.js";
import type { ChainMetadata, RpcEndpoint } from "../metadata.js";
import { deriveChainMetadataFromDefinitionSeed } from "../metadata.js";
import { HTTP_PROTOCOLS, isUrlWithProtocols, RPC_PROTOCOLS } from "../url.js";
import { eip155ChainIdHexFromChainRef, eip155ChainRefFromChainIdHex } from "./format.js";

const trimmed = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim() === value, { message: "Value must not include leading or trailing whitespace" });

const rpcUrl = z.url().refine((url) => isUrlWithProtocols(url, RPC_PROTOCOLS), {
  message: "URL must use http, https, ws, or wss protocol",
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

export const createEip155DefinitionSeedFromEip3085 = (input: unknown): ChainDefinitionSeed<RpcEndpoint> => {
  const payload = eip3085Schema.parse(input);

  const chainId = Hex.fromNumber(Hex.toBigInt(payload.chainId));
  const chainRef = eip155ChainRefFromChainIdHex(chainId);

  const rpcUrls = dedupe(payload.rpcUrls).filter(Boolean);
  if (rpcUrls.length === 0) {
    throw new Error("At least one valid rpcUrl is required");
  }

  const explorers = payload.blockExplorerUrls
    ? dedupe(payload.blockExplorerUrls).map((url) => ({
        type: "default",
        url,
        title: payload.chainName,
      }))
    : undefined;

  return {
    definition: {
      chainRef,
      displayName: payload.chainName,
      shortName: payload.nativeCurrency.symbol,
      nativeCurrency: payload.nativeCurrency,
      blockExplorers: explorers,
    },
    defaultRpcEndpoints: rpcUrls.map((url) => ({ url, type: "public" as const })),
  };
};

export const createEip155MetadataFromEip3085 = (input: unknown): ChainMetadata => {
  const seed = createEip155DefinitionSeedFromEip3085(input);
  return deriveChainMetadataFromDefinitionSeed({
    seed,
    namespace: "eip155",
    chainId: eip155ChainIdHexFromChainRef(seed.definition.chainRef),
  });
};
