import { describe, expect, it } from "vitest";
import { cloneChainDefinition, validateChainDefinition } from "./definition.js";
import type { ChainDefinition } from "./types.js";

const baseDefinition: ChainDefinition = {
  chainRef: "eip155:1",
  name: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ url: "https://etherscan.io", name: "Etherscan" }],
  iconUrl: "https://assets.example.com/ethereum.svg",
};

describe("ChainDefinition", () => {
  it("clones canonical network metadata", () => {
    const clone = cloneChainDefinition(baseDefinition);

    expect(clone).toEqual(baseDefinition);
    expect(clone.nativeCurrency).not.toBe(baseDefinition.nativeCurrency);
    expect(clone.blockExplorers).not.toBe(baseDefinition.blockExplorers);
    expect(clone.blockExplorers?.[0]).not.toBe(baseDefinition.blockExplorers?.[0]);
  });

  it("validates only the canonical value shape", () => {
    expect(validateChainDefinition(baseDefinition)).toEqual(baseDefinition);
    expect(() =>
      validateChainDefinition({
        ...baseDefinition,
        displayName: baseDefinition.name,
      }),
    ).toThrow();
  });
});
