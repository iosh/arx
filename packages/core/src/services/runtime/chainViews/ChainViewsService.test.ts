import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../../chains/metadata.js";
import { CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION, type ChainDefinitionEntity } from "../../../storage/index.js";
import { createChainViewsService } from "./ChainViewsService.js";

const MAINNET: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.ethereum.example", type: "public" }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const OPTIMISM: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const BASE: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
  features: ["eip155"],
};

const SOLANA: ChainMetadata = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana Mainnet",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

const toEntity = (metadata: ChainMetadata): ChainDefinitionEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  schemaVersion: CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  updatedAt: 0,
  source: "builtin",
});

const setup = (params?: {
  known?: ChainMetadata[];
  available?: ChainMetadata[];
  active?: ChainMetadata;
  selected?: ChainMetadata;
  activeByNamespace?: Record<string, string>;
}) => {
  const known = params?.known ?? [MAINNET, OPTIMISM, BASE, SOLANA];
  const available = params?.available ?? [MAINNET, OPTIMISM];
  const active = params?.active ?? MAINNET;
  const selected = params?.selected ?? active;

  return createChainViewsService({
    chainDefinitions: {
      getState: () => ({ chains: known.map(toEntity) }),
      getChain: (chainRef: string) => known.map(toEntity).find((entry) => entry.chainRef === chainRef) ?? null,
    } as never,
    network: {
      getState: () => ({
        revision: 1,
        activeChainRef: active.chainRef,
        availableChainRefs: available.map((chain) => chain.chainRef),
        rpc: {},
      }),
    } as never,
    preferences: {
      getSelectedChainRef: () => selected.chainRef,
      getActiveChainRef: (namespace: string) => params?.activeByNamespace?.[namespace] ?? null,
    } as never,
  });
};

describe("ChainViewsService", () => {
  it("builds known and mounted views separately", () => {
    const service = setup();

    expect(service.getActiveChainView()).toMatchObject({ chainRef: MAINNET.chainRef, chainId: MAINNET.chainId });
    expect(service.buildUiNetworksSnapshot()).toEqual({
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
    expect(service.buildProviderMeta()).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      activeChainByNamespace: { eip155: MAINNET.chainRef },
      supportedChains: [MAINNET.chainRef, OPTIMISM.chainRef],
    });
  });

  it("builds provider meta from namespace-specific active preferences", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      active: SOLANA,
      selected: SOLANA,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.getActiveChainView()).toMatchObject({ chainRef: SOLANA.chainRef });
    expect(service.buildProviderMeta()).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      activeChainByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
      supportedChains: [MAINNET.chainRef, SOLANA.chainRef],
    });
  });

  it("resolves wallet_switchEthereumChain targets from mounted eip155 chains", () => {
    const service = setup({ available: [MAINNET, BASE] });

    expect(service.resolveEip155SwitchChain({ chainId: BASE.chainId.toLowerCase() })).toMatchObject({
      chainRef: BASE.chainRef,
    });
    expect(service.resolveEip155SwitchChain({ chainRef: MAINNET.chainRef })).toMatchObject({
      chainId: MAINNET.chainId,
    });
  });

  it("rejects chains that are known but not mounted or not eip155", () => {
    const service = setup({ available: [MAINNET, SOLANA] });

    try {
      service.resolveEip155SwitchChain({ chainId: BASE.chainId.toLowerCase() });
      throw new Error("Expected mounted-set miss to throw");
    } catch (error) {
      expect(error).toMatchObject({ reason: ArxReasons.ChainNotFound });
    }

    try {
      service.resolveEip155SwitchChain({ chainRef: SOLANA.chainRef });
      throw new Error("Expected namespace mismatch to throw");
    } catch (error) {
      expect(error).toMatchObject({ reason: ArxReasons.ChainNotCompatible });
    }
  });

  it("uses selectedChainRef for wallet active views even when runtime legacy active differs", () => {
    const service = setup({ active: SOLANA, selected: MAINNET, available: [MAINNET, SOLANA] });

    expect(service.getActiveChainView()).toMatchObject({ chainRef: MAINNET.chainRef });
    expect(service.buildUiNetworksSnapshot().active).toBe(MAINNET.chainRef);
  });
});
