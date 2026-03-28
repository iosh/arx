import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { NetworkStateInput } from "../../controllers/network/types.js";
import { buildRuntimeNetworkPlan } from "./networkDefaults.js";

const ETH_MAINNET: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.eth.example", type: "public" }],
};

const BASE_MAINNET: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
};

const SOLANA_MAINNET: ChainMetadata = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

describe("buildRuntimeNetworkPlan", () => {
  it("derives selectedNamespace and activeChainByNamespace from admitted chains", () => {
    const plan = buildRuntimeNetworkPlan({
      admittedChains: [BASE_MAINNET, SOLANA_MAINNET],
    });

    expect(plan.bootstrapState.availableChainRefs).toEqual([BASE_MAINNET.chainRef]);
    expect(plan.preferencesDefaults).toEqual({
      selectedNamespace: BASE_MAINNET.namespace,
      activeChainByNamespace: {
        eip155: BASE_MAINNET.chainRef,
        solana: SOLANA_MAINNET.chainRef,
      },
    });
  });

  it("keeps a resolvable requested initial state and aligns defaults with it", () => {
    const requestedInitialState: NetworkStateInput = {
      availableChainRefs: [SOLANA_MAINNET.chainRef, BASE_MAINNET.chainRef],
      rpc: {
        [SOLANA_MAINNET.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
        [BASE_MAINNET.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    };

    const plan = buildRuntimeNetworkPlan({
      admittedChains: [BASE_MAINNET, SOLANA_MAINNET],
      requestedInitialState,
    });

    expect(plan.bootstrapState).toEqual(requestedInitialState);
    expect(plan.deferredState).toBeNull();
    expect(plan.preferencesDefaults).toEqual({
      selectedNamespace: SOLANA_MAINNET.namespace,
      activeChainByNamespace: {
        eip155: BASE_MAINNET.chainRef,
        solana: SOLANA_MAINNET.chainRef,
      },
    });
  });

  it("falls back to the first admitted chain when the requested initial state references an unavailable chain", () => {
    const requestedInitialState: NetworkStateInput = {
      availableChainRefs: [ETH_MAINNET.chainRef],
      rpc: {
        [ETH_MAINNET.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
      },
    };

    const plan = buildRuntimeNetworkPlan({
      admittedChains: [BASE_MAINNET],
      requestedInitialState,
    });

    expect(plan.bootstrapState.availableChainRefs).toEqual([BASE_MAINNET.chainRef]);
    expect(plan.deferredState).toEqual(requestedInitialState);
    expect(plan.preferencesDefaults).toEqual({
      selectedNamespace: BASE_MAINNET.namespace,
      activeChainByNamespace: {
        eip155: BASE_MAINNET.chainRef,
      },
    });
  });
});
