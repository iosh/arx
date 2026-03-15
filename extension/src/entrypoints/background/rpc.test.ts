import { describe, expect, it } from "vitest";
import { buildRpcContext, deriveRpcContextNamespace } from "./rpc";

describe("background rpc helpers", () => {
  it("derives namespace from a valid chainRef", () => {
    expect(deriveRpcContextNamespace({ chainRef: "solana:101" })).toBe("solana");
  });

  it("ignores malformed chainRef values and falls back to provider binding", () => {
    expect(deriveRpcContextNamespace({ chainRef: "solana", providerNamespace: "eip155" })).toBe("eip155");
  });

  it("builds rpc context from port context and explicit chainRef override", () => {
    const rpcContext = buildRpcContext(
      {
        origin: "https://example.app",
        providerNamespace: "eip155",
        meta: null,
        chainRef: "eip155:1",
        chainId: "0x1",
      },
      "eip155:10",
    );

    expect(rpcContext).toMatchObject({
      providerNamespace: "eip155",
      chainRef: "eip155:10",
      meta: null,
    });
  });
});
