import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../../../chains/metadata.js";
import { resolveSwitchEthereumChainTarget } from "./resolveSwitchEthereumChainTarget.js";

const MAINNET: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.ethereum.example", type: "public" }],
};

const BASE: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
};

const SOLANA: ChainMetadata = {
  chainRef: "eip155:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana Mainnet",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

const setup = (available: ChainMetadata[]) => {
  return {
    supportedChains: {
      getChain: (chainRef: string) => {
        const metadata = available.find((chain) => chain.chainRef === chainRef);
        return metadata ? { metadata } : null;
      },
    } as const,
    chainRpc: {
      hasEndpoints: (chainRef: string) => available.some((chain) => chain.chainRef === chainRef),
    } as const,
  };
};

describe("resolveSwitchEthereumChainTarget", () => {
  it("resolves mounted eip155 chains through the EVM hex chainId projection", () => {
    const deps = setup([MAINNET, BASE]);

    expect(
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainId: "0X02105",
      }),
    ).toMatchObject({
      chainRef: BASE.chainRef,
    });
  });

  it("rejects unavailable EVM chainIds", () => {
    const deps = setup([MAINNET]);

    expect(() =>
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainId: BASE.chainId.toLowerCase(),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "chain.not_found",
      }),
    );
  });

  it("rejects corrupted metadata under the projected eip155 chainRef", () => {
    const deps = setup([MAINNET, SOLANA]);

    try {
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainId: "0x65",
      });
      throw new Error("Expected namespace mismatch to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "chain.not_compatible" });
    }
  });
});
