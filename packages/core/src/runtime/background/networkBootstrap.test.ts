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

const SOLANA_CHAIN: ChainMetadata = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

type ChainDefinitionSeed = {
  metadata: ChainMetadata;
  source?: "builtin" | "custom";
};

type MutableChainDefinitionsController = ChainDefinitionsController & {
  setChains(chains: ChainDefinitionSeed[]): void;
};

const createChainDefinitionsStub = (chains: ChainDefinitionSeed[]): MutableChainDefinitionsController => {
  let current = [...chains];
  const listeners = new Set<(state: ReturnType<ChainDefinitionsController["getState"]>) => void>();

  const toState = () => ({
    chains: current.map(({ metadata, source = "builtin" }) => toRegistryEntity(metadata, 0, source)),
  });

  const emit = () => {
    const state = toState();
    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    getState: () => toState(),
    getChain: (chainRef) => {
      const entry = current.find(({ metadata }) => metadata.chainRef === chainRef);
      return entry ? toRegistryEntity(entry.metadata, 0, entry.source ?? "builtin") : null;
    },
    getChains: () => toState().chains,
    reconcileBuiltinChains: async () => {},
    upsertCustomChain: async () => ({
      kind: "noop",
      chain: toRegistryEntity(current[0]?.metadata ?? DEFAULT_CHAIN, 0),
    }),
    removeCustomChain: async () => ({ removed: false }),
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
    defaults: { activeChainByNamespace: { [DEFAULT_CHAIN.namespace]: DEFAULT_CHAIN.chainRef } },
    now,
  });
  return { port, service };
};

describe("networkBootstrap", () => {
  it("mounts only admitted namespace chains and corrects stored preferences", async () => {
    const network = createNetworkController(DEFAULT_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([
      { metadata: DEFAULT_CHAIN },
      { metadata: ALT_CHAIN },
      { metadata: SOLANA_CHAIN },
    ]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 9, strategy: { id: "sticky" } },
        [SOLANA_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "round-robin" } },
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
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState()).toMatchObject({
      activeChainRef: ALT_CHAIN.chainRef,
      availableChainRefs: [DEFAULT_CHAIN.chainRef, ALT_CHAIN.chainRef],
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });
    await expect(port.get()).resolves.toMatchObject({
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });
  });

  it("updates mounted active chain when registry removes the current chain", async () => {
    const network = createNetworkController(DEFAULT_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([{ metadata: DEFAULT_CHAIN }, { metadata: ALT_CHAIN }]);
    const { service } = createPreferencesService({
      id: "network-preferences",
      activeChainByNamespace: { eip155: DEFAULT_CHAIN.chainRef },
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
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });
    const chainViews = createChainViewsService({
      chainDefinitions,
      network,
      preferences: service,
    });

    await bootstrap.loadPreferences();
    bootstrap.start();
    chainDefinitions.setChains([{ metadata: ALT_CHAIN }]);

    expect(network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
    expect(chainViews.getActiveChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });

    await bootstrap.flushPendingSync();
    bootstrap.destroy();
  });

  it("does not persist direct network.switchChain calls as a bootstrap side effect", async () => {
    const network = createNetworkController(DEFAULT_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([{ metadata: DEFAULT_CHAIN }, { metadata: ALT_CHAIN }]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      activeChainByNamespace: { eip155: DEFAULT_CHAIN.chainRef },
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
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();
    bootstrap.start();

    await network.switchChain(ALT_CHAIN.chainRef);

    expect(network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
    await expect(port.get()).resolves.toMatchObject({ activeChainByNamespace: { eip155: DEFAULT_CHAIN.chainRef } });

    bootstrap.destroy();
  });
});
