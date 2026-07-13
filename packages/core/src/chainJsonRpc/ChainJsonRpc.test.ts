import { describe, expect, it, vi } from "vitest";
import { ChainJsonRpc } from "./ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError } from "./errors.js";
import { JsonRpcProtocolError, JsonRpcTransportError } from "./JsonRpcHttpTransport.js";

const endpointA = { url: "https://a.example" };
const endpointB = { url: "https://b.example" };
const endpoints = { getRpcEndpoints: () => [endpointA, endpointB] as const };

describe("ChainJsonRpc", () => {
  it("fails over to the next endpoint after a transport failure", async () => {
    const transport = {
      request: vi.fn().mockRejectedValueOnce(new JsonRpcTransportError("offline")).mockResolvedValueOnce("0x1"),
    };
    const rpc = new ChainJsonRpc({ endpoints, transport });

    await expect(rpc.request<string>({ chainRef: "eip155:1", method: "eth_chainId" })).resolves.toBe("0x1");
    expect(transport.request.mock.calls.map(([endpoint]) => endpoint.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("retries a safe request when only one endpoint is configured", async () => {
    const transport = {
      request: vi.fn().mockRejectedValueOnce(new JsonRpcTransportError("offline")).mockResolvedValueOnce("0x1"),
    };
    const rpc = new ChainJsonRpc({
      endpoints: { getRpcEndpoints: () => [endpointA] as const },
      transport,
    });

    await expect(rpc.request<string>({ chainRef: "eip155:1", method: "eth_chainId" })).resolves.toBe("0x1");
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an explicit JSON-RPC error", async () => {
    const transport = { request: vi.fn().mockRejectedValue(new JsonRpcProtocolError(-32000, "rejected")) };
    const rpc = new ChainJsonRpc({ endpoints, transport });

    await expect(rpc.request({ chainRef: "eip155:1", method: "eth_call" })).rejects.toBeInstanceOf(
      ChainJsonRpcResponseError,
    );
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("does not replay a request marked never", async () => {
    const transport = { request: vi.fn().mockRejectedValue(new JsonRpcTransportError("timeout")) };
    const rpc = new ChainJsonRpc({ endpoints, transport });

    await expect(
      rpc.request({ chainRef: "eip155:1", method: "eth_sendRawTransaction", replay: "never" }),
    ).rejects.toBeInstanceOf(ChainJsonRpcOutcomeUnknownError);
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
