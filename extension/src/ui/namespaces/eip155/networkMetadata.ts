import { z } from "zod";
import { isHttpUrl } from "@/ui/utils/url";

export type Eip155NetworkMetadata = {
  name: string;
  symbol: string;
  decimals: number;
  explorer: string;
};

const metadataSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().trim().min(1),
  nativeCurrency: z.object({
    symbol: z.string().trim().min(1),
    decimals: z.number().int().nonnegative(),
  }),
  explorers: z.array(z.object({ url: z.string() })).optional(),
});

async function getMetadata(url: string, chainId: bigint): Promise<Eip155NetworkMetadata | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Network metadata returned HTTP ${response.status}.`);
  const metadata = metadataSchema.parse(await response.json());
  if (BigInt(metadata.chainId) !== chainId) {
    throw new Error("Network metadata belongs to a different chain.");
  }

  return {
    name: metadata.name,
    symbol: metadata.nativeCurrency.symbol,
    decimals: metadata.nativeCurrency.decimals,
    explorer: metadata.explorers?.find(({ url }) => isHttpUrl(url))?.url ?? "",
  };
}

/** Gets editable defaults from the CDN, then the upstream repository if needed. */
export async function getEip155NetworkMetadata(chainId: bigint): Promise<Eip155NetworkMetadata | null> {
  const path = `_data/chains/eip155-${chainId.toString(10)}.json`;
  const sources = [
    `https://cdn.jsdelivr.net/gh/ethereum-lists/chains@master/${path}`,
    `https://raw.githubusercontent.com/ethereum-lists/chains/master/${path}`,
  ];
  const failures: unknown[] = [];
  for (const url of sources) {
    try {
      const metadata = await getMetadata(url, chainId);
      if (metadata) return metadata;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Network metadata could not be loaded.");
  return null;
}
