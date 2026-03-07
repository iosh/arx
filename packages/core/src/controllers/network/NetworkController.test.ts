import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { Messenger } from "../../messenger/Messenger.js";
import { buildNetworkRuntimeInput, createNetworkRuntimeInput } from "./config.js";
import { InMemoryNetworkController } from "./NetworkController.js";
import { NETWORK_TOPICS } from "./topics.js";
import type { NetworkStateInput, RpcEndpointChange, RpcEndpointHealth, RpcOutcomeReport } from "./types.js";

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

const stateFromMetadata = (metadata: ChainMetadata, overrides?: Partial<NetworkStateInput>): NetworkStateInput => {
  const base: NetworkStateInput = {
    activeChainRef: metadata.chainRef,
    availableChainRefs: [metadata.chainRef],
    rpc: {
      [metadata.chainRef]: {
        activeIndex: 0,
        strategy: { id: "round-robin" },
      },
    },
  };
  return { ...base, ...(overrides ?? {}) };
};

const runtimeFromMetadata = (metadata: ChainMetadata, overrides?: Partial<NetworkStateInput>) => {
  return buildNetworkRuntimeInput(stateFromMetadata(metadata, overrides), [metadata]);
};

describe("InMemoryNetworkController", () => {
  it("rotates endpoints and records failures", () => {
    const metadata = createMetadata();
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    const now = 1_000;
    const logger = vi.fn();

    const endpointChanges: RpcEndpointChange[] = [];
    const healthUpdates: Array<{ chainRef: string; health: RpcEndpointHealth[] }> = [];

    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata),
      now: () => now,
      defaultCooldownMs: 10_000,
      defaultStrategy: { id: "round-robin" },
      logger,
    });

    controller.onRpcEndpointChanged((change) => endpointChanges.push(change));
    controller.onRpcHealthChanged((update) => healthUpdates.push(update));

    const failure: RpcOutcomeReport = {
      success: false,
      error: { message: "upstream error" },
    };

    controller.reportRpcOutcome(metadata.chainRef, failure);

    expect(controller.getState().rpc[metadata.chainRef]?.activeIndex).toBe(1);
    expect(endpointChanges).toHaveLength(1);
    expect(endpointChanges[0]?.next.index).toBe(1);

    const lastHealth = healthUpdates.at(-1);
    expect(lastHealth?.chainRef).toBe(metadata.chainRef);
    expect(lastHealth?.health[0]?.failureCount).toBe(1);
    expect(lastHealth?.health[0]?.consecutiveFailures).toBe(1);
    expect(lastHealth?.health[0]?.cooldownUntil).toBe(11_000);

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "rpcFailure", chainRef: metadata.chainRef }));
  });

  it("clears cooldown and logs recovery on success", () => {
    const metadata = createMetadata({
      rpcEndpoints: [{ url: "https://rpc.only.example", type: "public" as const }],
    });
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    let now = 5_000;
    const logger = vi.fn();

    const healthUpdates: Array<{ chainRef: string; health: RpcEndpointHealth[] }> = [];

    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata),
      now: () => now,
      defaultCooldownMs: 5_000,
      logger,
    });

    controller.onRpcHealthChanged((update) => healthUpdates.push(update));

    controller.reportRpcOutcome(metadata.chainRef, {
      success: false,
      error: { message: "temporary" },
    });

    now = 11_000;
    controller.reportRpcOutcome(metadata.chainRef, { success: true });

    const last = healthUpdates.at(-1)?.health[0];
    expect(last?.consecutiveFailures).toBe(0);
    expect(last?.lastError).toBeUndefined();
    expect(last?.cooldownUntil).toBeUndefined();

    // One failure + one recovery.
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "rpcFailure", chainRef: metadata.chainRef }));
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: "rpcRecovery", chainRef: metadata.chainRef }));
  });

  it("clamps routing index when registry metadata changes", () => {
    const metadata = createMetadata();
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata, {
        rpc: { [metadata.chainRef]: { activeIndex: 1, strategy: { id: "round-robin" } } },
      }),
    });

    const updates: Array<{ chainRef: string }> = [];
    controller.onChainConfigChanged((payload) => updates.push(payload));

    const firstEndpoint = metadata.rpcEndpoints[0];
    if (!firstEndpoint) {
      throw new Error("Expected chain metadata to have at least one RPC endpoint");
    }

    const updated: ChainMetadata = {
      ...metadata,
      rpcEndpoints: [{ url: firstEndpoint.url, type: "public" as const }],
    };

    controller.replaceState(
      runtimeFromMetadata(updated, {
        rpc: { [updated.chainRef]: { activeIndex: 1, strategy: { id: "round-robin" } } },
      }),
    );

    expect(controller.getState().rpc[metadata.chainRef]?.activeIndex).toBe(0);
    expect(updates.some((u) => u.chainRef === metadata.chainRef)).toBe(true);
  });

  it("rejects missing chain configs for available chains", () => {
    const metadata = createMetadata();
    const alt = createMetadata({
      chainRef: "eip155:10",
      chainId: "0xa",
      displayName: "Optimism",
      rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" as const }],
    });
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata),
    });

    expect(() =>
      controller.replaceState(
        buildNetworkRuntimeInput(
          {
            activeChainRef: metadata.chainRef,
            availableChainRefs: [metadata.chainRef, alt.chainRef],
            rpc: {
              [metadata.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
              [alt.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
            },
          },
          [metadata],
        ),
      ),
    ).toThrow(`Network state for ${alt.chainRef} is missing chain config`);
  });

  it("rejects duplicate chain configs", () => {
    const metadata = createMetadata();
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata),
    });

    expect(() =>
      controller.replaceState(
        createNetworkRuntimeInput({
          state: stateFromMetadata(metadata),
          chainConfigs: [
            { chainRef: metadata.chainRef, rpcEndpoints: [...metadata.rpcEndpoints] },
            { chainRef: metadata.chainRef, rpcEndpoints: [...metadata.rpcEndpoints] },
          ],
        }),
      ),
    ).toThrow(`Duplicate network chain config for ${metadata.chainRef}`);
  });

  it("rejects empty rpc endpoints in chain config", () => {
    const metadata = createMetadata();
    const bus = new Messenger();
    const messenger = bus.scope({ publish: NETWORK_TOPICS });
    const controller = new InMemoryNetworkController({
      messenger,
      initialRuntime: runtimeFromMetadata(metadata),
    });

    expect(() =>
      controller.replaceState(
        createNetworkRuntimeInput({
          state: stateFromMetadata(metadata),
          chainConfigs: [{ chainRef: metadata.chainRef, rpcEndpoints: [] }],
        }),
      ),
    ).toThrow(`Chain ${metadata.chainRef} must expose at least one RPC endpoint`);
  });
});
