import { describe, expect, it, vi } from "vitest";
import { createChainJsonRpc } from "./ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "./errors.js";
import { ChainJsonRpcHttpTransportError, createJsonRpcHttpTransport } from "./JsonRpcHttpTransport.js";

const endpointA = "https://a.example";
const endpointB = "https://b.example";
const endpoints = { getRpcEndpoints: () => [endpointA, endpointB] as const };

describe("ChainJsonRpc", () => {
  it("keeps waiting for the primary and tries the backup if the connection eventually fails", async () => {
    vi.useFakeTimers();
    try {
      const primary = Promise.withResolvers<Response>();
      const fetch = vi.fn<typeof globalThis.fetch>(async (endpoint, init) => {
        if (endpoint === endpointA) {
          init?.signal?.addEventListener("abort", () => primary.reject(new TypeError("aborted")), { once: true });
          return primary.promise;
        }
        const { id } = JSON.parse(init?.body as string);
        return Response.json({ jsonrpc: "2.0", id, result: "0x1" });
      });
      const rpc = createChainJsonRpc({ endpoints, transport: createJsonRpcHttpTransport({ fetch }) });
      const response = rpc.request({ chainRef: "eip155:1", method: "eth_blockNumber" });
      const settled = vi.fn();
      void response.then(settled, settled);

      await vi.advanceTimersByTimeAsync(60_001);
      expect(settled).not.toHaveBeenCalled();
      expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([endpointA]);

      primary.reject(new TypeError("connection lost"));
      await expect(response).resolves.toBe("0x1");
      expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([endpointA, endpointB]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports unavailable after trying every endpoint once", async () => {
    const transport = {
      request: vi.fn().mockRejectedValue(new ChainJsonRpcHttpTransportError("offline")),
    };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(rpc.request({ chainRef: "eip155:1", method: "eth_blockNumber" })).rejects.toMatchObject({
      code: "chain_json_rpc.unavailable",
    });
    expect(transport.request.mock.calls.map(([request]) => request.endpoint)).toEqual([endpointA, endpointB]);
  });

  it("does not retry an explicit JSON-RPC error", async () => {
    const transport = {
      request: vi.fn().mockRejectedValue(
        new ChainJsonRpcResponseError({
          rpcCode: -32000,
          message: "rejected",
          data: { reason: "insufficient funds" },
        }),
      ),
    };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(rpc.request({ chainRef: "eip155:1", method: "eth_call" })).rejects.toMatchObject({
      code: "chain_json_rpc.response_error",
      rpcCode: -32000,
      rpcData: { reason: "insufficient funds" },
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
