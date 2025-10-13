import { describe, expect, it } from "vitest";
import { createDefaultChainModuleRegistry } from "./registry.js";

const registry = createDefaultChainModuleRegistry();

describe("ChainModuleRegistry", () => {
  it("normalizes address via registered descriptor", () => {
    const normalized = registry.normalizeAddress({
      chainRef: "eip155:1",
      value: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });
    expect(normalized.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("throws when chain descriptor is missing", () => {
    expect(() =>
      registry.normalizeAddress({
        chainRef: "solana:mainnet",
        value: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/No chain descriptor/);
  });
});
