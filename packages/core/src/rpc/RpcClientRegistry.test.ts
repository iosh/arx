import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../chains/metadata.js";
import type { RpcEndpointInfo, RpcOutcomeReport } from "../controllers/network/types.js";
import { createEip155RpcClientFactory, type Eip155RpcCapabilities } from "./clients/eip155/eip155.js";
import {
  type RpcClientFactory,
  RpcClientRegistry,
  type RpcClientRegistryOptions,
  type RpcTransportRequest,
} from "./RpcClientRegistry.js";

const createNetworkStub = () => {
  let currentEndpoint: RpcEndpointInfo = { index: 0, url: "https://rpc.initial", headers: undefined };
  const outcomes: Array<{ chainRef: string; outcome: RpcOutcomeReport }> = [];
  const endpointListeners = new Set<
    (change: { chainRef: string; previous: RpcEndpointInfo; next: RpcEndpointInfo }) => void
  >();
  const chainListeners = new Set<(metadata: ChainMetadata) => void>();

  const stub: RpcClientRegistryOptions["network"] = {
    getActiveEndpoint: () => currentEndpoint,
    reportRpcOutcome(chainRef, outcome) {
      outcomes.push({ chainRef, outcome });
    },
    onRpcEndpointChanged(handler) {
      endpointListeners.add(handler);
      return () => {
        endpointListeners.delete(handler);
      };
    },
    onChainChanged(handler) {
      chainListeners.add(handler);
      return () => {
        chainListeners.delete(handler);
      };
    },
  };

  const emitEndpointChanged = (chainRef: string, previous: RpcEndpointInfo, next: RpcEndpointInfo) => {
    for (const handler of endpointListeners) {
      handler({ chainRef, previous, next });
    }
  };

  const emitChainChanged = (chainRef: string, url: string) => {
    const metadata: ChainMetadata = {
      chainRef,
      namespace: chainRef.split(":")[0] ?? "eip155",
      chainId: "0x1",
      displayName: "Stub Chain",
      nativeCurrency: { name: "Stub", symbol: "STB", decimals: 18 },
      rpcEndpoints: [{ url }],
    };
    for (const handler of chainListeners) {
      handler(metadata);
    }
  };

  return {
    stub,
    outcomes,
    setEndpoint(chainRef: string, url: string, headers?: Record<string, string>) {
      const previous = currentEndpoint;
      currentEndpoint = { ...currentEndpoint, url, headers };
      emitEndpointChanged(chainRef, previous, currentEndpoint);
      emitChainChanged(chainRef, url);
    },
  };
};

describe("RpcClientRegistry", () => {
  it("merges endpoint headers into transport requests", async () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    });
    const registry = new RpcClientRegistry({ network: network.stub, fetch });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    network.setEndpoint("eip155:1", "https://rpc.with-headers", { Authorization: "Bearer token" });
    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).resolves.toBe("0x1");

    const lastCall = fetch.mock.calls.at(-1);
    if (!lastCall) {
      throw new Error("fetch was not called");
    }
    const [_, init] = lastCall;
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
  });
  it("caches clients per namespace/chain and invalidates on network updates", () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const registry = new RpcClientRegistry({ network: network.stub, fetch });

    const factory: RpcClientFactory = vi.fn(({ transport }) => ({
      request: <T>(payload: RpcTransportRequest<T>) => transport(payload),
    }));

    registry.registerFactory("custom", factory);

    const first = registry.getClient("custom", "custom:1");
    const second = registry.getClient("custom", "custom:1");
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);

    network.setEndpoint("custom:1", "https://rpc.next");
    const third = registry.getClient("custom", "custom:1");
    expect(third).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("reports success and failure outcomes through the network controller", async () => {
    const network = createNetworkStub();
    const responses = [
      new Response(JSON.stringify({ result: "0x1" }), { status: 200 }),
      new Response(JSON.stringify({ error: { message: "boom", code: -32000 } }), { status: 200 }),
    ];
    const fetch = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));

    const registry = new RpcClientRegistry({ network: network.stub, fetch, maxAttempts: 1 });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    await expect(client.request({ method: "eth_fail" })).rejects.toThrow(/boom/);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(network.outcomes.length).toBeGreaterThanOrEqual(2);
    expect(network.outcomes[0]).toMatchObject({
      chainRef: "eip155:1",
      outcome: { success: true, endpointIndex: 0 },
    });
    const failures = network.outcomes.filter((entry) => entry.outcome.success === false);
    expect(failures.length).toBeGreaterThanOrEqual(1);
    const lastFailure = failures[failures.length - 1];
    if (!lastFailure || lastFailure.outcome.success !== false) {
      throw new Error("Expected failure outcome");
    }
    expect(lastFailure.outcome.error.message).toContain("boom");
  });

  it("retries failed requests with exponential backoff", async () => {
    vi.useFakeTimers();
    const network = createNetworkStub();
    let attempts = 0;

    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ error: { message: "fail", code: -32000 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    });

    const registry = new RpcClientRegistry({ network: network.stub, fetch, maxAttempts: 3, retryBackoffMs: 300 });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    const pending = client.request({ method: "eth_chainId" });
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1200);

    await expect(pending).resolves.toBe("0x1");
    expect(fetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("continues retrying when a timeout is provided", async () => {
    vi.useFakeTimers();
    const network = createNetworkStub();
    let attempts = 0;

    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise((_, reject) => reject(new DOMException("timeout", "AbortError")));
      }
      return new Response(JSON.stringify({ result: "0x1" }), { status: 200 });
    });

    const registry = new RpcClientRegistry({ network: network.stub, fetch, maxAttempts: 2, defaultTimeoutMs: 5_000 });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");
    const pending = client.request({ method: "eth_chainId", timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe("0x1");
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("converts HTTP 500 into RPC errors", async () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async () => new Response("Internal error", { status: 500, statusText: "fail" }));
    const registry = new RpcClientRegistry({ network: network.stub, fetch });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).rejects.toThrow(/HTTP 500/);
    expect(network.outcomes.at(-1)?.outcome.success).toBe(false);
  });

  it("handles invalid JSON responses gracefully", async () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async () => new Response("{invalid", { status: 200 }));
    const registry = new RpcClientRegistry({ network: network.stub, fetch });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const client = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    await expect(client.request({ method: "eth_chainId" })).rejects.toThrow(/Failed to parse RPC response/);
  });

  it("supports concurrent clients across namespaces", () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const registry = new RpcClientRegistry({ network: network.stub, fetch });

    const customFactory: RpcClientFactory = ({ transport }) => ({
      request: (payload) => transport(payload),
    });

    registry.registerFactory("custom", customFactory);
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    const foo = registry.getClient("custom", "custom:1");
    const bar = registry.getClient("custom", "custom:1");
    const baz = registry.getClient<Eip155RpcCapabilities>("eip155", "eip155:1");

    expect(foo).toBe(bar);
    expect(foo).not.toBe(baz as unknown);

    registry.destroy();
  });

  it("removes subscriptions on destroy", () => {
    const network = createNetworkStub();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const registry = new RpcClientRegistry({ network: network.stub, fetch });
    registry.registerFactory("eip155", createEip155RpcClientFactory());

    registry.getClient("eip155", "eip155:1");
    registry.destroy();

    network.setEndpoint("eip155:1", "https://rpc.next");
    expect(network.outcomes).toHaveLength(0);
  });
});
