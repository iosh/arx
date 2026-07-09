import { describe, expect, it } from "vitest";
import type { ChainDefinitionSeed, RpcEndpoint } from "../../definition.js";
import { buildChainAdmission } from "./chainAdmission.js";

const BASE_MAINNET: ChainDefinitionSeed<RpcEndpoint> = {
  definition: {
    chainRef: "eip155:8453",
    displayName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
};

const SOLANA_MAINNET: ChainDefinitionSeed<RpcEndpoint> = {
  definition: {
    chainRef: "solana:101",
    displayName: "Solana",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
  defaultRpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

describe("buildChainAdmission", () => {
  it("derives wallet chain selection defaults from admitted chains", () => {
    const admission = buildChainAdmission({
      admittedChainSeeds: [BASE_MAINNET, SOLANA_MAINNET],
    });

    expect(admission.selectionDefaults).toEqual({
      selectedNamespace: "eip155",
      chainRefByNamespace: {
        eip155: BASE_MAINNET.definition.chainRef,
        solana: SOLANA_MAINNET.definition.chainRef,
      },
    });
  });

  it("returns cloned admitted chain metadata", () => {
    const admission = buildChainAdmission({
      admittedChainSeeds: [BASE_MAINNET],
    });

    const admittedDefaultEndpoint = admission.admittedChainSeeds[0].defaultRpcEndpoints?.[0];
    expect(admittedDefaultEndpoint).toBeDefined();

    admittedDefaultEndpoint.url = "https://mutated.example";

    expect(BASE_MAINNET.defaultRpcEndpoints?.[0]?.url).toBe("https://rpc.base.example");
  });

  it("rejects empty admission with an owner-local chain config error", () => {
    expect(() => buildChainAdmission({ admittedChainSeeds: [] })).toThrowError(
      expect.objectContaining({
        code: "chain.admission_config_invalid",
        details: { reason: "missing_admitted_chain" },
      }),
    );
  });
});
