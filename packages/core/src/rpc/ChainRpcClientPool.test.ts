import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcEndpoint } from "../chains/metadata.js";
import type { ChainRpcClientPoolOptions } from "./ChainRpcClientPool.js";
import { ChainRpcClientPool, type RpcClientFactory, type RpcTransportRequest } from "./ChainRpcClientPool.js";
import { createEip155RpcClientFactory, type Eip155RpcCapabilities } from "./namespaceClients/eip155.js";

const createChainRpcStub = () => {
  let endpoints: [RpcEndpoint, ...RpcEndpoint[]] = [{ url: "https://rpc.initial", headers: undefined }];
  const endpointListeners = new Set<(event: { chainRef: string }) => void>();

  const stub: ChainRpcClientPoolOptions["chainRpc"] = {
    getEndpoints: () =>
      endpoints.map((endpoint) => ({
        ...endpoint,
        headers: endpoint.headers ? { ...endpoint.headers } : undefined,
      })) as [RpcEndpoint, ...RpcEndpoint[]],
    onEndpointsChanged(handler) {
      endpointListeners.add(handler);
      return () => {
        endpointListeners.delete(handler);
      };
    },
  };

  return {
    stub,
    setEndpoints(chainRef: string, next: [RpcEndpoint, ...RpcEndpoint[]]) {
      endpoints = next;
      for (const handler of endpointListeners) {
        handler({ chainRef });
      }
    },
  };
};

describe("ChainRpcClientPool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges endpoint headers into transport requests", async () => {
    const chainRpc = createChainRpcStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: "0x1" }), { status: 200 }));
    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch });
    pool.registerFactory("eip155", createEip155RpcClientFactory());

    chainRpc.setEndpoints("eip155:1", [
      { url: "https://rpc.with-headers", headers: { Authorization: "Bearer token" } },
    ]);
    const client = pool.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).resolves.toBe("0x1");

    const lastCall = fetch.mock.calls.at(-1);
    if (!lastCall) {
      throw new Error("fetch was not called");
    }
    const [, init] = lastCall;
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
  });

  it("caches clients per namespace/chain and invalidates on endpoint updates", () => {
    const chainRpc = createChainRpcStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch });

    const factory: RpcClientFactory = vi.fn(({ transport }) => ({
      request: <T>(payload: RpcTransportRequest<T>) => transport(payload),
    }));

    pool.registerFactory("custom", factory);

    const first = pool.getClient("custom", "custom:1");
    const second = pool.getClient("custom", "custom:1");
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);

    chainRpc.setEndpoints("custom:1", [{ url: "https://rpc.next" }]);
    const third = pool.getClient("custom", "custom:1");
    expect(third).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not retry transport failures unless the request explicitly allows it", async () => {
    const chainRpc = createChainRpcStub();
    chainRpc.setEndpoints("eip155:1", [{ url: "https://rpc.one" }, { url: "https://rpc.two" }]);
    const fetch = vi.fn(async () => new Response("Internal error", { status: 500, statusText: "fail" }));
    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch });
    pool.registerFactory("eip155", createEip155RpcClientFactory());

    const client = pool.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).rejects.toThrow(/HTTP 500/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries transport failures across endpoints when explicitly allowed", async () => {
    vi.useFakeTimers();
    const chainRpc = createChainRpcStub();
    chainRpc.setEndpoints("eip155:1", [{ url: "https://rpc.one" }, { url: "https://rpc.two" }]);
    let attempts = 0;

    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("Internal error", { status: 500, statusText: "fail" });
      }
      return new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    });

    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch, retryBackoffMs: 300 });
    pool.registerFactory("eip155", createEip155RpcClientFactory());

    const client = pool.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");
    const pending = client.request({ method: "eth_chainId", retry: { transportFailure: true } });

    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toBe("0x1");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://rpc.one");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://rpc.two");
  });

  it("does not retry JSON-RPC node errors", async () => {
    const chainRpc = createChainRpcStub();
    chainRpc.setEndpoints("eip155:1", [{ url: "https://rpc.one" }, { url: "https://rpc.two" }]);
    const fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "boom", code: -32000 } }), { status: 200 });
    });

    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch, retryBackoffMs: 300 });
    pool.registerFactory("eip155", createEip155RpcClientFactory());

    const client = pool.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_fail", retry: { transportFailure: true } })).rejects.toMatchObject({
      code: -32000,
      message: "boom",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid chainRef identifiers before creating clients", () => {
    const chainRpc = createChainRpcStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const pool = new ChainRpcClientPool({ chainRpc: chainRpc.stub, fetch });
    const factory: RpcClientFactory = vi.fn(({ transport }) => ({
      request: (payload) => transport(payload),
    }));
    pool.registerFactory("custom", factory);

    expect(() => pool.getClient("custom", "custom")).toThrow(/Invalid CAIP-2 chainRef/);
    expect(factory).not.toHaveBeenCalled();
  });
});
