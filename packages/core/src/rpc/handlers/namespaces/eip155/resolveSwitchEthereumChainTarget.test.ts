import { ArxReasons } from "@arx/errors";
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
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana Mainnet",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

const setup = (available: ChainMetadata[]) => {
  return {
    chainDefinitions: {
      getChain: (chainRef: string) => {
        const metadata = available.find((chain) => chain.chainRef === chainRef);
        return metadata ? { metadata } : null;
      },
    } as const,
    network: {
      getState: () => ({ availableChainRefs: available.map((chain) => chain.chainRef) }),
    } as const,
  };
};

describe("resolveSwitchEthereumChainTarget", () => {
  it("resolves mounted eip155 chains by chainId or chainRef", () => {
    const deps = setup([MAINNET, BASE]);

    expect(
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainId: BASE.chainId.toLowerCase(),
      }),
    ).toMatchObject({
      chainRef: BASE.chainRef,
    });

    expect(
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainRef: MAINNET.chainRef,
      }),
    ).toMatchObject({
      chainId: MAINNET.chainId,
    });
  });

  it("rejects chains that are unavailable or namespace-incompatible", () => {
    const deps = setup([MAINNET, SOLANA]);

    expect(() =>
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainId: BASE.chainId.toLowerCase(),
      }),
    ).toThrowError(
      expect.objectContaining({
        reason: ArxReasons.ChainNotFound,
      }),
    );

    try {
      resolveSwitchEthereumChainTarget({
        ...deps,
        chainRef: SOLANA.chainRef,
      });
      throw new Error("Expected namespace mismatch to throw");
    } catch (error) {
      expect(error).toMatchObject({ reason: ArxReasons.ChainNotCompatible });
    }
  });
});
