import { describe, expect, it } from "vitest";
import { buildMeta } from "./eip155.test.helpers.js";
import { Eip155ProviderState } from "./state.js";

describe("Eip155ProviderState", () => {
  it("falls back to the default namespace for malformed chainRef values", () => {
    const state = new Eip155ProviderState();

    expect(() =>
      state.applySnapshot({
        connected: true,
        chainId: "0x1",
        chainRef: "solana",
        accounts: [],
        isUnlocked: true,
        meta: buildMeta(),
      }),
    ).not.toThrow();

    expect(state.namespace).toBe("eip155");
  });

  it("derives networkVersion from a valid CAIP-2 chainRef when chainId is malformed", () => {
    const state = new Eip155ProviderState();

    state.applySnapshot({
      connected: true,
      chainId: "not-hex",
      chainRef: "eip155:137",
      accounts: [],
      isUnlocked: true,
      meta: buildMeta({ activeChainByNamespace: { eip155: "eip155:1" } }),
    });

    expect(state.getProviderState().networkVersion).toBe("137");
  });
});
