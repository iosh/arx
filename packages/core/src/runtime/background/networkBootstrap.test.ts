import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainDefinitionsController } from "../../controllers/chainDefinitions/types.js";
import { buildNetworkRuntimeInput } from "../../controllers/network/config.js";
import { InMemoryNetworkController } from "../../controllers/network/NetworkController.js";
import { NETWORK_TOPICS } from "../../controllers/network/topics.js";
import { Messenger } from "../../messenger/Messenger.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createNetworkPreferencesService } from "../../services/store/networkPreferences/NetworkPreferencesService.js";
import type { NetworkPreferencesRecord } from "../../storage/records.js";
import { MemoryNetworkPreferencesPort, toRegistryEntity } from "../__fixtures__/backgroundTestSetup.js";
import { buildDefaultRoutingState, DEFAULT_CHAIN } from "./constants.js";
import { createNetworkBootstrap } from "./networkBootstrap.js";

const ALT_CHAIN: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
};

const CUSTOM_CHAIN: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
};

const LEGACY_CHAIN: ChainMetadata = {
  chainRef: "eip155:31337",
  namespace: "eip155",
  chainId: "0x7a69",
  displayName: "Legacy",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.legacy.example", type: "public" }],
};

type MutableChainDefinitionsController = ChainDefinitionsController & {
  setChains(chains: ChainMetadata[]): void;
};

const createChainDefinitionsStub = (chains: ChainMetadata[]): MutableChainDefinitionsController => {
  let current = [...chains];
  const listeners = new Set<(state: ReturnType<ChainDefinitionsController["getState"]>) => void>();

  const emit = () => {
    const state = { chains: current.map((metadata) => toRegistryEntity(metadata, 0)) };
    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    getState: () => ({ chains: current.map((metadata) => toRegistryEntity(metadata, 0)) }),
    getChain: (chainRef) => {
      const metadata = current.find((chain) => chain.chainRef === chainRef);
      return metadata ? toRegistryEntity(metadata, 0) : null;
    },
    getChains: () => current.map((metadata) => toRegistryEntity(metadata, 0)),
    upsertChain: async () => ({ kind: "noop", chain: toRegistryEntity(current[0] ?? DEFAULT_CHAIN, 0) }),
    removeChain: async () => ({ removed: false }),
    onStateChanged: (handler) => {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    onChainUpdated: () => () => {},
    whenReady: async () => {},
    setChains: (chains) => {
      current = [...chains];
      emit();
    },
  };
};

const createNetworkController = (chain: ChainMetadata) => {
  const bus = new Messenger();
  return new InMemoryNetworkController({
    messenger: bus.scope({ publish: NETWORK_TOPICS }),
    initialRuntime: buildNetworkRuntimeInput(
      {
        activeChainRef: chain.chainRef,
        availableChainRefs: [chain.chainRef],
        rpc: { [chain.chainRef]: buildDefaultRoutingState(chain) },
      },
      [chain],
    ),
  });
};

const createPreferencesService = (seed: NetworkPreferencesRecord | null, now = () => 1_000) => {
  const port = new MemoryNetworkPreferencesPort(seed);
  const service = createNetworkPreferencesService({
    port,
    defaults: { activeChainRef: DEFAULT_CHAIN.chainRef },
    now,
  });
  return { port, service };
};

describe("networkBootstrap", () => {
  it("syncs registry chains, clamps rpc preferences, and prunes removed preferences", async () => {
    const network = createNetworkController(DEFAULT_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([DEFAULT_CHAIN, ALT_CHAIN]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      activeChainRef: ALT_CHAIN.chainRef,
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 9, strategy: { id: "sticky" } },
        [LEGACY_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
      },
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    const state = network.getState();
    expect(state.activeChainRef).toBe(ALT_CHAIN.chainRef);
    expect(state.availableChainRefs).toEqual([DEFAULT_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(state.rpc[ALT_CHAIN.chainRef]).toMatchObject({ activeIndex: 0, strategy: { id: "sticky" } });

    await expect(port.get()).resolves.toMatchObject({
      activeChainRef: ALT_CHAIN.chainRef,
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });
  });

  it("falls back to the default chain when preferred and current chains are unavailable", async () => {
    const network = createNetworkController(LEGACY_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([DEFAULT_CHAIN, ALT_CHAIN]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      activeChainRef: LEGACY_CHAIN.chainRef,
      rpc: {},
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState().activeChainRef).toBe(DEFAULT_CHAIN.chainRef);
    await expect(port.get()).resolves.toMatchObject({ activeChainRef: DEFAULT_CHAIN.chainRef });
  });

  it("falls back to the first registry chain when the default chain is unavailable", async () => {
    const network = createNetworkController(LEGACY_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([ALT_CHAIN, CUSTOM_CHAIN]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      activeChainRef: LEGACY_CHAIN.chainRef,
      rpc: {},
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
    await expect(port.get()).resolves.toMatchObject({ activeChainRef: ALT_CHAIN.chainRef });
  });

  it("updates network state synchronously when registry removes the active chain after preferences are loaded", async () => {
    const network = createNetworkController(DEFAULT_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([DEFAULT_CHAIN, ALT_CHAIN]);
    const { service } = createPreferencesService({
      id: "network-preferences",
      activeChainRef: DEFAULT_CHAIN.chainRef,
      rpc: {},
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
    });
    const chainViews = createChainViewsService({ chainDefinitions, network });

    await bootstrap.loadPreferences();
    bootstrap.start();

    chainDefinitions.setChains([ALT_CHAIN]);

    expect(network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
    expect(chainViews.getActiveChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });

    await bootstrap.flushPendingSync();
    bootstrap.destroy();
  });
});
