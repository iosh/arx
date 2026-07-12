import { describe, expect, it } from "vitest";
import { chainIdFromChainRef, chainRefFromChainId } from "./chainId.js";

describe("EIP-155 chain ID", () => {
  it("converts chain IDs to CAIP-2 chain refs", () => {
    expect(chainRefFromChainId(1n)).toBe("eip155:1");
    expect(chainRefFromChainId(8453n)).toBe("eip155:8453");
  });

  it("reads chain IDs from CAIP-2 chain refs", () => {
    expect(chainIdFromChainRef("eip155:1")).toBe(1n);
    expect(chainIdFromChainRef("eip155:8453")).toBe(8453n);
  });

  it("rejects negative chain IDs", () => {
    expect(() => chainRefFromChainId(-1n)).toThrow(expect.objectContaining({ code: "chain.invalid_ref" }));
  });

  it("rejects chain refs outside EIP-155", () => {
    expect(() => chainIdFromChainRef("solana:101")).toThrow('Chain solana:101 does not belong to namespace "eip155".');
  });

  it("rejects non-decimal EIP-155 references", () => {
    expect(() => chainIdFromChainRef("eip155:mainnet")).toThrow(expect.objectContaining({ code: "chain.invalid_ref" }));
  });
});
