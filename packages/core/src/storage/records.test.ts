import { describe, expect, it } from "vitest";
import { NetworkSelectionRecordSchema } from "./records.js";

describe("NetworkSelectionRecordSchema", () => {
  it("requires selectedNamespace", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        chainRefByNamespace: {
          solana: "solana:101",
          eip155: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("accepts records whose selected namespace resolves through chainRefByNamespace", () => {
    const parsed = NetworkSelectionRecordSchema.parse({
      id: "network-selection",
      selectedNamespace: "solana",
      chainRefByNamespace: {
        solana: "solana:101",
        eip155: "eip155:1",
      },
      updatedAt: 0,
    });

    expect(parsed.selectedNamespace).toBe("solana");
  });

  it("rejects records that provide neither selected owner field", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        chainRefByNamespace: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("rejects records whose selected namespace is missing from chainRefByNamespace", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        selectedNamespace: "solana",
        chainRefByNamespace: {
          eip155: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow(/must include the selected namespace/);
  });

  it("rejects chainRefByNamespace entries whose chainRef namespace drifts", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        selectedNamespace: "solana",
        chainRefByNamespace: {
          solana: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow(/must point to the same namespace/);
  });
});
