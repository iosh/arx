import { describe, expect, it, vi } from "vitest";
import {
  type ChainJsonRpcHttpProtocolError,
  type ChainJsonRpcHttpTransportError,
  createJsonRpcHttpTransport,
} from "./JsonRpcHttpTransport.js";

const endpoint = "https://rpc.example";

const requestBody = (init?: RequestInit): Record<string, unknown> => JSON.parse(init?.body as string);

describe("JsonRpcHttpTransport", () => {
  it("allocates an internal ID and parses one JSON-RPC request", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestBody(init);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(
      transport.request({
        endpoint,
        method: "eth_chainId",
        params: [],
      }),
    ).resolves.toBe("0x1");

    expect(fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      }),
    );
  });

  it("recognizes an explicit JSON-RPC error in a non-successful HTTP response", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestBody(init);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "rejected" } }),
        { status: 400 },
      );
    });
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(
      transport.request({ endpoint, method: "eth_call" }),
    ).rejects.toMatchObject<ChainJsonRpcHttpProtocolError>({
      code: "chain_json_rpc.http_protocol",
      rpcCode: -32000,
      message: "rejected",
    });
  });

  it("rejects a response with a different request ID", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: "0x1" }), {
          status: 200,
        }),
    );
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(
      transport.request({ endpoint, method: "eth_chainId" }),
    ).rejects.toMatchObject<ChainJsonRpcHttpTransportError>({
      code: "chain_json_rpc.http_transport",
      message: "JSON-RPC response does not match the request.",
    });
  });

  it("reports an aborted request as a timeout", async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(transport.request({ endpoint, method: "eth_chainId", timeoutMs: 1 })).rejects.toEqual(
      expect.objectContaining<ChainJsonRpcHttpTransportError>({
        code: "chain_json_rpc.http_transport",
        message: "RPC request timed out.",
      }),
    );
  });
});
