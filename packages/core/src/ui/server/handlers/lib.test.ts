import { describe, expect, it, vi } from "vitest";
import { resolveUiChainRefForNamespace } from "./lib.js";

describe("resolveUiChainRefForNamespace", () => {
  it("returns the selected UI chain when the namespace already matches", () => {
    const chains = {
      getSelectedChainView: () => ({ chainRef: "eip155:1", namespace: "eip155" }),
      getActiveChainViewForNamespace: vi.fn(),
    };

    expect(resolveUiChainRefForNamespace(chains as never, "eip155")).toBe("eip155:1");
    expect(chains.getActiveChainViewForNamespace).not.toHaveBeenCalled();
  });

  it("falls back to the namespace-specific active chain when selected UI chain is unavailable", () => {
    const chains = {
      getSelectedChainView: () => {
        throw new Error("selected UI chain unavailable");
      },
      getActiveChainViewForNamespace: vi.fn(() => ({ chainRef: "solana:101", namespace: "solana" })),
    };

    expect(resolveUiChainRefForNamespace(chains as never, "solana")).toBe("solana:101");
    expect(chains.getActiveChainViewForNamespace).toHaveBeenCalledWith("solana");
  });
});
