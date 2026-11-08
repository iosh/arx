import { afterEach, describe, expect, it, vi } from "vitest";
import { getEip155NetworkMetadata } from "./networkMetadata";

const base = {
  chainId: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  explorers: [{ url: "https://basescan.org" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("network metadata", () => {
  it("obtains metadata from upstream when the CDN fails", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "https://cdn.jsdelivr.net/gh/ethereum-lists/chains@master/_data/chains/eip155-8453.json") {
        return new Response("Unavailable", { status: 503 });
      }
      if (url === "https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/chains/eip155-8453.json") {
        return Response.json(base);
      }
      throw new Error(`Unexpected metadata URL: ${url}`);
    });

    const result = await getEip155NetworkMetadata(8453n);

    expect(result).toEqual({ name: "Base", symbol: "ETH", decimals: 18, explorer: "https://basescan.org" });
  });
});
