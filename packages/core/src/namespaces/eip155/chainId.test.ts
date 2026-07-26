import { describe, expect, it } from "vitest";
import { ChainNamespaceMismatchError } from "../../networks/errors.js";
import { chainIdFromChainRef, chainRefFromChainId } from "./chainId.js";
import { Eip155InvalidChainIdError } from "./errors.js";

const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER);

describe("EIP-155 chain ID", () => {
  it("converts chain IDs to CAIP-2 chain refs", () => {
    expect(chainRefFromChainId(1n)).toBe("eip155:1");
    expect(chainRefFromChainId(8453n)).toBe("eip155:8453");
    expect(chainRefFromChainId(MAX_SAFE_CHAIN_ID)).toBe(`eip155:${MAX_SAFE_CHAIN_ID}`);
  });

  it("reads chain IDs from CAIP-2 chain refs", () => {
    expect(chainIdFromChainRef("eip155:1")).toBe(1n);
    expect(chainIdFromChainRef("eip155:8453")).toBe(8453n);
  });

  it("rejects negative chain IDs", () => {
    expect(() => chainRefFromChainId(-1n)).toThrow(Eip155InvalidChainIdError);
  });

  it("rejects chain IDs outside the supported positive safe-integer range", () => {
    expect(() => chainRefFromChainId(0n)).toThrow(Eip155InvalidChainIdError);
    expect(() => chainRefFromChainId(MAX_SAFE_CHAIN_ID + 1n)).toThrow(Eip155InvalidChainIdError);
  });

  it("rejects chain refs outside EIP-155", () => {
    expect(() => chainIdFromChainRef("solana:101")).toThrow(ChainNamespaceMismatchError);
  });

  it("rejects non-decimal EIP-155 references", () => {
    expect(() => chainIdFromChainRef("eip155:mainnet")).toThrow(Eip155InvalidChainIdError);
    expect(() => chainIdFromChainRef("eip155:01")).toThrow(Eip155InvalidChainIdError);
  });
});
