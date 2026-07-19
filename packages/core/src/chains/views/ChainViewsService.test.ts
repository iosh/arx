import { describe, expect, it } from "vitest";
import { parseChainRef } from "../../networks/chainRef.js";
import { cloneChainDefinition } from "../../networks/definition.js";
import type { ChainDefinition } from "../../networks/types.js";
import { createChainViewsService } from "./ChainViewsService.js";

const MAINNET: ChainDefinition = {
  chainRef: "eip155:1",
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const OPTIMISM: ChainDefinition = {
  chainRef: "eip155:10",
  name: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const BASE: ChainDefinition = {
  chainRef: "eip155:8453",
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const SOLANA: ChainDefinition = {
  chainRef: "solana:101",
  name: "Solana Mainnet",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
};

const setup = (params?: {
  known?: ChainDefinition[];
  available?: ChainDefinition[];
  selectedNamespace?: string;
  activeByNamespace?: Record<string, string>;
}) => {
  const known = params?.known ?? [MAINNET, OPTIMISM, BASE, SOLANA];
  const available = params?.available ?? [MAINNET, OPTIMISM];
  const selectedNamespace = params?.selectedNamespace ?? parseChainRef(MAINNET.chainRef).namespace;

  return createChainViewsService({
    chainDefinitions: {
      getState: () => ({
        chains: known.map((definition) => ({
          chainRef: definition.chainRef,
          namespace: parseChainRef(definition.chainRef).namespace,
          definition: cloneChainDefinition(definition),
          source: "builtin" as const,
        })),
      }),
      getChain: (chainRef: string) => {
        const definition = known.find((entry) => entry.chainRef === chainRef);
        return definition
          ? {
              chainRef: definition.chainRef,
              namespace: parseChainRef(definition.chainRef).namespace,
              definition: cloneChainDefinition(definition),
              source: "builtin" as const,
            }
          : null;
      },
    } as never,
    chainRpc: {
      hasEndpoints: (chainRef: string) => available.some((chain) => chain.chainRef === chainRef),
      listChainRefs: () => available.map((chain) => chain.chainRef),
    } as never,
    selection: {
      getSelectedNamespace: () => selectedNamespace,
      getSelectedChainRef: (namespace: string) => params?.activeByNamespace?.[namespace] ?? null,
    } as never,
  });
};

describe("ChainViewsService", () => {
  it("builds known and mounted views separately", () => {
    const service = setup();

    expect(service.getSelectedNamespace()).toBe("eip155");
    expect(service.getSelectedChainView()).toMatchObject({ chainRef: MAINNET.chainRef });
    expect(service.getSelectedChainView()).not.toHaveProperty("chainId");
    expect(service.buildWalletNetworksSnapshot()).toEqual({
      selectedNamespace: "eip155",
      active: MAINNET.chainRef,
      known: expect.arrayContaining([
        expect.objectContaining({ chainRef: MAINNET.chainRef }),
        expect.objectContaining({ chainRef: OPTIMISM.chainRef }),
        expect.objectContaining({ chainRef: BASE.chainRef }),
        expect.objectContaining({ chainRef: SOLANA.chainRef }),
      ]),
      available: expect.arrayContaining([
        expect.objectContaining({ chainRef: MAINNET.chainRef }),
        expect.objectContaining({ chainRef: OPTIMISM.chainRef }),
      ]),
    });
    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
  });

  it("resolves active chain views from namespace-specific selection", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selectedNamespace: "solana",
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.getSelectedNamespace()).toBe("solana");
    expect(service.getSelectedChainView()).toMatchObject({ chainRef: SOLANA.chainRef });
    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
    expect(service.getActiveChainViewForNamespace("solana")).toMatchObject({ chainRef: SOLANA.chainRef });
  });

  it("resolves active chain views when selected namespace differs from the requested namespace", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selectedNamespace: "solana",
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
  });

  it("throws when the selected namespace has no available chain in the runtime", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selectedNamespace: "cosmos",
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(() => service.getSelectedChainView()).toThrow(/no available chain/i);
  });
});
