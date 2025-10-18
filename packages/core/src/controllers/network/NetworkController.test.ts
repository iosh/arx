import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryNetworkController } from "./NetworkController.js";
import type {
  NetworkMessengerTopic,
  NetworkState,
  RpcEndpointChange,
  RpcEndpointState,
  RpcOutcomeReport,
} from "./types.js";

const createMetadata = (overrides?: Partial<ChainMetadata>): ChainMetadata => ({
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [
    { url: "https://rpc.primary.example", type: "public" as const },
    { url: "https://rpc.backup.example", type: "public" as const },
  ],
  ...overrides,
});

const stateFromMetadata = (metadata: ChainMetadata): NetworkState => {
  const endpoints = metadata.rpcEndpoints.map((endpoint, index) => ({
    index,
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: endpoint.headers ? { ...endpoint.headers } : undefined,
  }));

  const health = endpoints.map((endpoint) => ({
    index: endpoint.index,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
  }));

  const rpc: Record<string, RpcEndpointState> = {
    [metadata.chainRef]: {
      activeIndex: 0,
      endpoints,
      health,
      strategy: { id: "round-robin" },
      lastUpdatedAt: 0,
    },
  };

  return {
    activeChain: metadata.chainRef,
    knownChains: [metadata],
    rpc,
  } satisfies NetworkState;
};

describe("InMemoryNetworkController", () => {
  it("rotates endpoints and records failures", () => {
    const metadata = createMetadata();
    const messenger = new ControllerMessenger<NetworkMessengerTopic>({});
    const now = 1_000;
    const logger = vi.fn();
    const endpointChanges: RpcEndpointChange[] = [];

    const controller = new InMemoryNetworkController({
      messenger,
      initialState: stateFromMetadata(metadata),
      now: () => now,
      defaultCooldownMs: 10_000,
      defaultStrategy: { id: "round-robin" },
      logger,
    });

    controller.onRpcEndpointChanged((change) => {
      endpointChanges.push(change);
    });

    const failure: RpcOutcomeReport = {
      success: false,
      error: { message: "upstream error" },
    };

    controller.reportRpcOutcome(metadata.chainRef, failure);

    const state = controller.getEndpointState(metadata.chainRef);
    expect(state?.activeIndex).toBe(1);
    expect(state?.health[0]?.failureCount).toBe(1);
    expect(state?.health[0]?.consecutiveFailures).toBe(1);
    expect(state?.health[0]?.cooldownUntil).toBe(11_000);
    expect(endpointChanges).toHaveLength(1);
    expect(endpointChanges[0]?.next.index).toBe(1);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "rpcFailure", chainRef: metadata.chainRef }));
  });

  it("preserves index and clears cooldown on success", () => {
    const metadata = createMetadata();
    const messenger = new ControllerMessenger<NetworkMessengerTopic>({});
    let now = 5_000;
    const logger = vi.fn();

    const controller = new InMemoryNetworkController({
      messenger,
      initialState: stateFromMetadata(metadata),
      now: () => now,
      defaultCooldownMs: 5_000,
      logger,
    });

    controller.reportRpcOutcome(metadata.chainRef, {
      success: false,
      error: { message: "temporary" },
    });

    now = 11_000;
    controller.reportRpcOutcome(metadata.chainRef, { success: true });

    const state = controller.getEndpointState(metadata.chainRef);
    expect(state?.activeIndex).toBe(controller.getActiveEndpoint().index);
    expect(state?.health[controller.getActiveEndpoint().index]?.consecutiveFailures).toBe(0);
    expect(state?.health[controller.getActiveEndpoint().index]?.lastError).toBeUndefined();
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "rpcFailure", chainRef: metadata.chainRef }));
  });

  it("syncs metadata and reinitialises endpoints when registry updates", async () => {
    const metadata = createMetadata();
    const messenger = new ControllerMessenger<NetworkMessengerTopic>({});

    const controller = new InMemoryNetworkController({
      messenger,
      initialState: stateFromMetadata(metadata),
    });

    const updatedMetadata: ChainMetadata = {
      ...metadata,
      rpcEndpoints: [
        { url: "https://rpc.primary.example", type: "public" as const },
        { url: "https://rpc.secondary.example", type: "public" as const },
        { url: "https://rpc.tertiary.example", type: "public" as const },
      ],
    };

    await controller.syncChain(updatedMetadata);

    const state = controller.getEndpointState(metadata.chainRef);
    expect(state?.endpoints).toHaveLength(3);
    expect(state?.health).toHaveLength(3);
    expect(state?.activeIndex).toBeLessThan(3);
  });
});
