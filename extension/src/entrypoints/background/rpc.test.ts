import { describe, expect, it } from "vitest";
import { createCoreProviderRpcRequest } from "./rpc";

describe("background rpc helpers", () => {
  it("builds a core JSON-RPC request from parsed provider payload", () => {
    const request = createCoreProviderRpcRequest({
      id: "rpc-1",
      jsonrpc: "2.0",
      method: "eth_chainId",
    });

    expect(request).toEqual({
      id: "rpc-1",
      jsonrpc: "2.0",
      method: "eth_chainId",
    });
  });
});
