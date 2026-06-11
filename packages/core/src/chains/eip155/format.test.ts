import { describe, expect, it } from "vitest";
import { eip155ChainIdHexFromChainRef, eip155ChainRefFromChainIdHex } from "./format.js";

describe("EIP-155 format conversion", () => {
  it("derives CAIP-2 chainRefs from EVM chainId hex values", () => {
    expect(eip155ChainRefFromChainIdHex("0x1")).toBe("eip155:1");
    expect(eip155ChainRefFromChainIdHex("0X02105")).toBe("eip155:8453");
  });

  it("derives EVM chainId hex values from CAIP-2 chainRefs", () => {
    expect(eip155ChainIdHexFromChainRef("eip155:1")).toBe("0x1");
    expect(eip155ChainIdHexFromChainRef("eip155:8453")).toBe("0x2105");
  });

  it("rejects non-hex or whitespace-padded EVM chainId values", () => {
    expect(() => eip155ChainRefFromChainIdHex("not-hex")).toThrow("0x-prefixed hexadecimal");
    expect(() => eip155ChainRefFromChainIdHex("0xGG")).toThrow("0x-prefixed hexadecimal");
    expect(() => eip155ChainRefFromChainIdHex(" 0x1 ")).toThrow("0x-prefixed hexadecimal");
  });

  it("rejects non-eip155 or non-decimal chainRefs for EVM chainId projection", () => {
    expect(() => eip155ChainIdHexFromChainRef("solana:101")).toThrow(
      expect.objectContaining({
        code: "chain.namespace_mismatch",
      }),
    );
    expect(() => eip155ChainIdHexFromChainRef("eip155:mainnet")).toThrow(
      expect.objectContaining({
        code: "chain.invalid_ref",
        details: { rule: "reference" },
      }),
    );
  });
});
