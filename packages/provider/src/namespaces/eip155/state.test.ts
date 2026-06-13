import { describe, expect, it } from "vitest";
import { applyProviderPatch, Eip155ProviderState, type ProviderSnapshot } from "./state.js";

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
    });

    expect(state.getProviderState().networkVersion).toBe("137");
  });

  it("applies chain patches to a snapshot without mutating the original value", () => {
    const snapshot: ProviderSnapshot = {
      connected: true,
      chainId: "0x1",
      chainRef: "eip155:1",
      accounts: ["0xabc"],
      isUnlocked: true,
    };

    const nextSnapshot = applyProviderPatch(snapshot, {
      type: "chain",
      chainId: "0x89",
      chainRef: "eip155:137",
      isUnlocked: false,
    });

    expect(snapshot.chainId).toBe("0x1");
    expect(snapshot.chainRef).toBe("eip155:1");
    expect(snapshot.isUnlocked).toBe(true);
    expect(nextSnapshot).toMatchObject({
      chainId: "0x89",
      chainRef: "eip155:137",
      isUnlocked: false,
    });
  });
});
