import { describe, expect, it } from "vitest";
import { areRpcEndpointsEqual, assertNonEmptyRpcEndpoints, cloneNonEmptyRpcEndpoints } from "./config.js";

describe("chain RPC endpoint helpers", () => {
  it("clones non-empty RPC endpoints", () => {
    const endpoints = assertNonEmptyRpcEndpoints("eip155:1", [
      {
        url: "https://rpc.ethereum.example",
        type: "authenticated",
        headers: { Authorization: "Bearer token", "X-Client": "arx" },
      },
    ]);

    const cloned = cloneNonEmptyRpcEndpoints(endpoints);
    endpoints[0].headers.Authorization = "Changed";

    expect(cloned).toEqual([
      {
        url: "https://rpc.ethereum.example",
        type: "authenticated",
        headers: { Authorization: "Bearer token", "X-Client": "arx" },
      },
    ]);
  });

  it("compares endpoint fields directly", () => {
    const a = [{ url: "https://rpc.ethereum.example", headers: { Authorization: "a", "X-Client": "arx" } }];
    const b = [{ url: "https://rpc.ethereum.example", headers: { "X-Client": "arx", Authorization: "a" } }];

    expect(areRpcEndpointsEqual(a, b)).toBe(true);
    expect(areRpcEndpointsEqual(a, [{ url: "https://rpc.other.example" }])).toBe(false);
  });

  it("rejects empty endpoint lists with an owner-local error", () => {
    expect(() => assertNonEmptyRpcEndpoints("eip155:1", [])).toThrowError(
      expect.objectContaining({
        code: "chain.rpc_access_config_invalid",
        details: { chainRef: "eip155:1", reason: "empty_endpoints" },
      }),
    );
  });
});
