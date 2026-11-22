import { describe, expect, it } from "vitest";
import { chainIdFromChainRef, chainRefFromChainId, MAX_EIP155_CHAIN_ID } from "./chainId.js";
import { Eip155InvalidChainIdError } from "./errors.js";

describe("EIP-155 chain ID", () => {
  it("converts chain IDs to CAIP-2 chain refs", () => {
    expect(chainRefFromChainId(1n)).toBe("eip155:1");
    expect(chainRefFromChainId(8453n)).toBe("eip155:8453");
    expect(chainRefFromChainId(MAX_EIP155_CHAIN_ID)).toBe(`eip155:${MAX_EIP155_CHAIN_ID}`);
  });

  it("reads chain IDs from CAIP-2 chain refs", () => {
    expect(chainIdFromChainRef("eip155:1")).toBe(1n);
    expect(chainIdFromChainRef("eip155:8453")).toBe(8453n);
    expect(chainIdFromChainRef(`eip155:${MAX_EIP155_CHAIN_ID}`)).toBe(MAX_EIP155_CHAIN_ID);
  });

  it("rejects chain IDs outside the wallet's supported positive range", () => {
    expect(() => chainRefFromChainId(-1n)).toThrow(Eip155InvalidChainIdError);
    expect(() => chainRefFromChainId(0n)).toThrow(Eip155InvalidChainIdError);
    expect(() => chainRefFromChainId(MAX_EIP155_CHAIN_ID + 1n)).toThrow(Eip155InvalidChainIdError);
  });
});
