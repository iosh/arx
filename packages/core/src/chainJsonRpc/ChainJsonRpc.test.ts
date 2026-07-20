import { describe, expect, it, vi } from "vitest";
import { createChainJsonRpc } from "./ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError } from "./errors.js";
import { ChainJsonRpcHttpProtocolError, ChainJsonRpcHttpTransportError } from "./JsonRpcHttpTransport.js";

const endpointA = "https://a.example";
const endpointB = "https://b.example";
const endpoints = { getRpcEndpoints: () => [endpointA, endpointB] as const };

describe("ChainJsonRpc", () => {
  it("fails over to the next endpoint after a transport failure", async () => {
    const transport = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new ChainJsonRpcHttpTransportError("offline"))
        .mockResolvedValueOnce("0x1"),
    };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(rpc.request<string>({ chainRef: "eip155:1", method: "eth_chainId", replay: "allowed" })).resolves.toBe(
      "0x1",
    );
    expect(transport.request.mock.calls.map(([request]) => request.endpoint)).toEqual([endpointA, endpointB]);
    expect(transport.request.mock.calls.every(([request]) => !("timeoutMs" in request))).toBe(true);
  });

  it("reports unavailable after trying every endpoint once", async () => {
    const transport = {
      request: vi.fn().mockRejectedValue(new ChainJsonRpcHttpTransportError("offline")),
    };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(rpc.request({ chainRef: "eip155:1", method: "eth_chainId", replay: "allowed" })).rejects.toMatchObject(
      {
        code: "chain_json_rpc.unavailable",
        details: { chainRef: "eip155:1", method: "eth_chainId", attempts: 2 },
      },
    );
    expect(transport.request.mock.calls.map(([request]) => request.endpoint)).toEqual([endpointA, endpointB]);
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an explicit JSON-RPC error", async () => {
    const transport = {
      request: vi.fn().mockRejectedValue(
        new ChainJsonRpcHttpProtocolError({
          rpcCode: -32000,
          message: "rejected",
          data: { reason: "insufficient funds" },
        }),
      ),
    };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(rpc.request({ chainRef: "eip155:1", method: "eth_call", replay: "allowed" })).rejects.toMatchObject({
      code: "chain_json_rpc.response_error",
      rpcCode: -32000,
      rpcData: { reason: "insufficient funds" },
      details: {
        chainRef: "eip155:1",
        method: "eth_call",
        rpcCode: -32000,
        rpcData: { reason: "insufficient funds" },
      },
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("does not replay a request when replay is forbidden", async () => {
    const transport = { request: vi.fn().mockRejectedValue(new ChainJsonRpcHttpTransportError("timeout")) };
    const rpc = createChainJsonRpc({ endpoints, transport });

    await expect(
      rpc.request({ chainRef: "eip155:1", method: "eth_sendRawTransaction", replay: "forbidden" }),
    ).rejects.toBeInstanceOf(ChainJsonRpcOutcomeUnknownError);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
