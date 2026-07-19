import { describe, expect, it } from "vitest";
import { areRpcEndpointsEqual, assertNonEmptyRpcEndpoints, cloneNonEmptyRpcEndpoints } from "./config.js";

describe("chain RPC endpoint helpers", () => {
  it("clones non-empty RPC endpoint arrays", () => {
    const endpoints = assertNonEmptyRpcEndpoints("eip155:1", ["https://rpc.ethereum.example"]);
    const cloned = cloneNonEmptyRpcEndpoints(endpoints);

    expect(cloned).toEqual(["https://rpc.ethereum.example"]);
    expect(cloned).not.toBe(endpoints);
  });

  it("compares endpoint strings directly", () => {
    expect(areRpcEndpointsEqual(["https://rpc.ethereum.example"], ["https://rpc.ethereum.example"])).toBe(true);
    expect(areRpcEndpointsEqual(["https://rpc.ethereum.example"], ["https://rpc.other.example"])).toBe(false);
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
