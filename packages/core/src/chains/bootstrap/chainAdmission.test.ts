import { describe, expect, it } from "vitest";
import type { BuiltinNetworkSeed } from "../../../networks/types.js";
import { buildChainAdmission } from "./chainAdmission.js";

const BASE_MAINNET: BuiltinNetworkSeed = {
  definition: {
    chainRef: "eip155:8453",
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://rpc.base.example"],
};

const SOLANA_MAINNET: BuiltinNetworkSeed = {
  definition: {
    chainRef: "solana:101",
    name: "Solana",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
  defaultRpcEndpoints: ["https://rpc.solana.example"],
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

    expect(admission.admittedChainSeeds[0]?.defaultRpcEndpoints).toEqual(["https://rpc.base.example"]);
    expect(admission.admittedChainSeeds[0]?.defaultRpcEndpoints).not.toBe(BASE_MAINNET.defaultRpcEndpoints);
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
