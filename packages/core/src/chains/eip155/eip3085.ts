import { z } from "zod";
import type { ChainMetadata } from "../metadata.js";
import { validateChainMetadata } from "../metadata.js";

//https://eips.ethereum.org/EIPS/eip-3085

const trimmed = () =>
  z
    .string()
    .min(1)
    .transform((value) => value.trim());
const httpUrl = z.url().refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
  error: "URL must use http or https scheme",
});

const eip3085Schema = z.object({
  chainId: trimmed(),
  chainName: trimmed(),
  nativeCurrency: z.object({
    name: trimmed(),
    symbol: trimmed(),
    decimals: z.number().int().nonnegative(),
  }),
  rpcUrls: z.array(httpUrl).min(1),
  blockExplorerUrls: z.array(httpUrl).optional(),
  // TODO add iconUrls
});

const dedupe = (values: readonly string[]) => Array.from(new Set(values.map((value) => value.trim())));

const normaliseHexChainId = (chainId: string) => {
  const lower = chainId.toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(lower)) {
    throw new Error("chainId must be a 0x-prefixed hexadecimal string");
  }
  return lower;
};

const toChainRef = (hexChainId: string) => {
  const reference = BigInt(hexChainId).toString(10);
  return `eip155:${reference}`;
};

export const createEip155MetadataFromEip3085 = (input: unknown): ChainMetadata => {
  const payload = eip3085Schema.parse(input);

  const chainId = normaliseHexChainId(payload.chainId);
  const chainRef = toChainRef(chainId);

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

  const metadata: ChainMetadata = {
    chainRef,
    namespace: "eip155",
    chainId,
    displayName: payload.chainName,
    shortName: payload.nativeCurrency.symbol,
    nativeCurrency: payload.nativeCurrency,
    rpcEndpoints: rpcUrls.map((url) => ({ url, type: "public" as const })),
    blockExplorers: explorers,
    features: ["eip155", "wallet_addEthereumChain", "wallet_switchEthereumChain"],
    tags: ["user-added"],
    extensions: {
      source: "eip3085",
    },
  };

  return validateChainMetadata(metadata);
};
