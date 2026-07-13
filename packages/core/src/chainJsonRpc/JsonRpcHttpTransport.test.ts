import { describe, expect, it, vi } from "vitest";
import {
  createJsonRpcHttpTransport,
  type JsonRpcProtocolError,
  type JsonRpcTransportError,
} from "./JsonRpcHttpTransport.js";

const endpoint = { url: "https://rpc.example", headers: { Authorization: "Bearer token" } };

describe("JsonRpcHttpTransport", () => {
  it("sends and parses one JSON-RPC request", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: "0x1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(
      transport.request(endpoint, {
        id: 7,
        method: "eth_chainId",
        params: [],
        timeoutMs: 1_000,
      }),
    ).resolves.toBe("0x1");
    expect(fetch).toHaveBeenCalledWith(
      endpoint.url,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] }),
      }),
    );
  });

  it("recognizes an explicit JSON-RPC error in a non-successful HTTP response", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: "rejected" } }), {
          status: 400,
        }),
    );
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(
      transport.request(endpoint, { id: 7, method: "eth_call", timeoutMs: 1_000 }),
    ).rejects.toMatchObject<JsonRpcProtocolError>({ code: -32000, message: "rejected" });
  });

  it("reports an aborted request as a timeout", async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const transport = createJsonRpcHttpTransport({ fetch });

    await expect(transport.request(endpoint, { id: 7, method: "eth_chainId", timeoutMs: 1 })).rejects.toEqual(
      expect.objectContaining<JsonRpcTransportError>({ message: "RPC request timed out." }),
    );
  });
});
