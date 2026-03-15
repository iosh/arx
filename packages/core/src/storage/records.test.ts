import { describe, expect, it } from "vitest";
import { NetworkPreferencesRecordSchema } from "./records.js";

describe("NetworkPreferencesRecordSchema", () => {
  it("requires selectedChainRef", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        activeChainByNamespace: {
          solana: "solana:101",
          eip155: "eip155:1",
        },
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("accepts records with an explicit selectedChainRef", () => {
    const parsed = NetworkPreferencesRecordSchema.parse({
      id: "network-preferences",
      selectedChainRef: "solana:101",
      activeChainByNamespace: {
        solana: "solana:101",
        eip155: "eip155:1",
      },
      rpc: {},
      updatedAt: 0,
    });

    expect(parsed.selectedChainRef).toBe("solana:101");
  });

  it("rejects records that provide neither selectedChainRef nor namespace selections", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        activeChainByNamespace: {},
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("rejects activeChainByNamespace entries whose chainRef namespace drifts", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        selectedChainRef: "solana:101",
        activeChainByNamespace: {
          solana: "eip155:1",
        },
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow(/must point to the same namespace/);
  });
});
