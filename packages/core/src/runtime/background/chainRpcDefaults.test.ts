import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { buildRuntimeChainAdmission } from "./chainRpcDefaults.js";

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

describe("buildRuntimeChainAdmission", () => {
  it("derives wallet chain selection defaults from admitted chains", () => {
    const admission = buildRuntimeChainAdmission({
      admittedChains: [BASE_MAINNET, SOLANA_MAINNET],
    });

    expect(admission.selectionDefaults).toEqual({
      selectedNamespace: BASE_MAINNET.namespace,
      chainRefByNamespace: {
        eip155: BASE_MAINNET.chainRef,
        solana: SOLANA_MAINNET.chainRef,
      },
    });
  });

  it("returns cloned admitted chain metadata", () => {
    const admission = buildRuntimeChainAdmission({ admittedChains: [BASE_MAINNET] });

    admission.admittedChains[0].rpcEndpoints[0].url = "https://mutated.example";

    expect(BASE_MAINNET.rpcEndpoints[0]?.url).toBe("https://rpc.base.example");
  });

  it("rejects empty admission with an owner-local runtime config error", () => {
    expect(() => buildRuntimeChainAdmission({ admittedChains: [] })).toThrowError(
      expect.objectContaining({
        code: "runtime.config_invalid",
        details: { reason: "missing_admitted_chain" },
      }),
    );
  });
});
