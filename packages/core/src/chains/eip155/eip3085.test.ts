import { describe, expect, it } from "vitest";
import { createEip155DefinitionSeedFromEip3085 } from "./eip3085.js";

const baseRequest = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://mainnet.base.org", "https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

describe("EIP-3085 chain import", () => {
  it("projects wallet_addEthereumChain input to a chain definition seed", () => {
    const seed = createEip155DefinitionSeedFromEip3085(baseRequest);

    expect(seed.definition).toEqual({
      chainRef: "eip155:8453",
      displayName: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://basescan.org", title: "Base" }],
    });
    expect(seed.definition).not.toHaveProperty("namespace");
    expect(seed.definition).not.toHaveProperty("chainId");
    expect(seed.definition).not.toHaveProperty("rpcEndpoints");
    expect(seed.defaultRpcEndpoints).toEqual([{ url: "https://mainnet.base.org", type: "public" }]);
  });
});
