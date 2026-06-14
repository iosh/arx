import { describe, expect, it } from "vitest";
import { ApprovalKinds } from "../../../approvals/queue/types.js";
import type { ChainMetadata } from "../../../chains/metadata.js";
import { createChainViewsService } from "./ChainViewsService.js";

const MAINNET: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.ethereum.example", type: "public" }],
};

const OPTIMISM: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
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

const setup = (params?: {
  known?: ChainMetadata[];
  available?: ChainMetadata[];
  selectedNamespace?: string;
  activeByNamespace?: Record<string, string>;
}) => {
  const known = params?.known ?? [MAINNET, OPTIMISM, BASE, SOLANA];
  const available = params?.available ?? [MAINNET, OPTIMISM];
  const selectedNamespace = params?.selectedNamespace ?? MAINNET.namespace;

  return createChainViewsService({
    supportedChains: {
      getState: () => ({
        chains: known.map((metadata) => ({
          chainRef: metadata.chainRef,
          namespace: metadata.namespace,
          metadata,
          source: "builtin" as const,
        })),
      }),
      getChain: (chainRef: string) => {
        const metadata = known.find((entry) => entry.chainRef === chainRef);
        return metadata
          ? {
              chainRef: metadata.chainRef,
              namespace: metadata.namespace,
              metadata,
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

    expect(service.getSelectedNamespace()).toBe(MAINNET.namespace);
    expect(service.getSelectedChainView()).toMatchObject({ chainRef: MAINNET.chainRef, chainId: MAINNET.chainId });
    expect(service.buildWalletNetworksSnapshot()).toEqual({
      selectedNamespace: MAINNET.namespace,
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
      selectedNamespace: SOLANA.namespace,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(service.getSelectedNamespace()).toBe(SOLANA.namespace);
    expect(service.getSelectedChainView()).toMatchObject({ chainRef: SOLANA.chainRef });
    expect(service.getActiveChainViewForNamespace("eip155")).toMatchObject({ chainRef: MAINNET.chainRef });
    expect(service.getActiveChainViewForNamespace("solana")).toMatchObject({ chainRef: SOLANA.chainRef });
  });

  it("resolves active chain views when selected namespace differs from the requested namespace", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selectedNamespace: SOLANA.namespace,
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

  it("derives approval review chains without falling back to wallet selected chain", () => {
    const service = setup({
      available: [MAINNET, SOLANA],
      selectedNamespace: SOLANA.namespace,
      activeByNamespace: { eip155: MAINNET.chainRef, solana: SOLANA.chainRef },
    });

    expect(
      service.getApprovalReviewChainView({
        record: {
          approvalId: "approval-1",
          kind: ApprovalKinds.RequestAccounts,
          namespace: "eip155",
          chainRef: MAINNET.chainRef,
        },
      }),
    ).toMatchObject({ chainRef: MAINNET.chainRef, namespace: MAINNET.namespace });

    expect(() =>
      service.getApprovalReviewChainView({
        record: {
          approvalId: "approval-2",
          kind: ApprovalKinds.SignMessage,
          namespace: "eip155",
          chainRef: MAINNET.chainRef,
        },
        request: { chainRef: SOLANA.chainRef },
      }),
    ).toThrow(/mismatched namespace and chainref/i);
  });
});
