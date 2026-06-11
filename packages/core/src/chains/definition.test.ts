import { describe, expect, it } from "vitest";
import type { ChainDefinition } from "./definition.js";
import { cloneChainDefinition } from "./definition.js";

const baseDefinition: ChainDefinition = {
  chainRef: "eip155:1",
  displayName: "Ethereum Mainnet",
  shortName: "eth",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ type: "default", url: "https://etherscan.io", title: "Etherscan" }],
  icon: { url: "https://assets.example.com/ethereum.svg", width: 64, height: 64, format: "svg" },
};

describe("ChainDefinition", () => {
  it("clones nested display metadata", () => {
    const clone = cloneChainDefinition(baseDefinition);

    expect(clone).toEqual(baseDefinition);
    expect(clone.nativeCurrency).not.toBe(baseDefinition.nativeCurrency);
    expect(clone.blockExplorers).not.toBe(baseDefinition.blockExplorers);
    expect(clone.blockExplorers?.[0]).not.toBe(baseDefinition.blockExplorers?.[0]);
    expect(clone.icon).not.toBe(baseDefinition.icon);
  });
});
