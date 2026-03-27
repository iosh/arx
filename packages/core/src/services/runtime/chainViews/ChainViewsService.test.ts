import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../../chains/metadata.js";
import { ApprovalKinds } from "../../../controllers/approval/types.js";
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
  selected?: ChainMetadata;
  activeByNamespace?: Record<string, string>;
}) => {
  const known = params?.known ?? [MAINNET, OPTIMISM, BASE, SOLANA];
  const available = params?.available ?? [MAINNET, OPTIMISM];
  const selected = params?.selected ?? MAINNET;

  return createChainViewsService({
    chainDefinitions: {
      getState: () => ({ chains: known.map(toEntity) }),
      getChain: (chainRef: string) => known.map(toEntity).find((entry) => entry.chainRef === chainRef) ?? null,
    } as never,
    network: {
      getState: () => ({
        revision: 1,
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

    expect(service.getSelectedChainView()).toMatchObject({ chainRef: MAINNET.chainRef, chainId: MAINNET.chainId });
    expect(service.buildWalletNetworksSnapshot()).toEqual({
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
    expect(service.buildProviderMeta("eip155")).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      activeChainByNamespace: { eip155: MAINNET.chainRef },
      supportedChains: [MAINNET.chainRef, OPTIMISM.chainRef],
    });
    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
  });

  it("builds provider meta from namespace-specific active preferences", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selected: SOLANA,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.getSelectedChainView()).toMatchObject({ chainRef: SOLANA.chainRef });
    expect(service.buildProviderMeta("eip155")).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      activeChainByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
      supportedChains: [MAINNET.chainRef, SOLANA.chainRef],
    });
    expect(service.getActiveChainViewForNamespace("solana")).toMatchObject({ chainRef: SOLANA.chainRef });
  });

  it("builds provider meta even when wallet selectedChainRef is currently unavailable", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selected: BASE,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.buildProviderMeta("eip155")).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      activeChainByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
      supportedChains: [MAINNET.chainRef, SOLANA.chainRef],
    });
    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
  });

  it("throws when selectedChainRef is not mounted in the runtime", () => {
    const service = setup({ selected: BASE, available: [MAINNET, SOLANA] });

    expect(() => service.getSelectedChainView()).toThrow(/not available/i);
  });

  it("derives approval review chains without falling back to wallet selected chain", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selected: SOLANA,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(
      service.getApprovalReviewChainView({
        record: {
          id: "approval-1",
          kind: ApprovalKinds.RequestAccounts,
          namespace: "eip155",
          chainRef: MAINNET.chainRef,
        },
      }),
    ).toMatchObject({ chainRef: MAINNET.chainRef, namespace: MAINNET.namespace });

    expect(() =>
      service.getApprovalReviewChainView({
        record: {
          id: "approval-2",
          kind: ApprovalKinds.SignMessage,
          namespace: "eip155",
          chainRef: MAINNET.chainRef,
        },
        request: { chainRef: SOLANA.chainRef },
      }),
    ).toThrow(/mismatched namespace and chainref/i);
  });
});
