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
import { buildDefaultRoutingState } from "./constants.js";
import { createNetworkBootstrap } from "./networkBootstrap.js";

const MAINNET_CHAIN: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.mainnet.example", type: "public" }],
};

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
      chain: toRegistryEntity(current[0]?.metadata ?? MAINNET_CHAIN, 0),
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
        availableChainRefs: [chain.chainRef],
        rpc: { [chain.chainRef]: buildDefaultRoutingState(chain) },
      },
      [chain],
    ),
  });
};

const createPreferencesService = (
  seed: NetworkPreferencesRecord | null,
  defaults = {
    selectedNamespace: MAINNET_CHAIN.namespace,
    activeChainByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
  },
  now = () => 1_000,
) => {
  const port = new MemoryNetworkPreferencesPort(seed);
  const service = createNetworkPreferencesService({
    port,
    defaults,
    now,
  });
  return { port, service };
};

describe("networkBootstrap", () => {
  it("mounts only admitted namespace chains and corrects stored preferences", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([
      { metadata: MAINNET_CHAIN },
      { metadata: ALT_CHAIN },
      { metadata: SOLANA_CHAIN },
    ]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      selectedChainRef: ALT_CHAIN.chainRef,
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
      preferencesDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        selectedChainRef: MAINNET_CHAIN.chainRef,
        activeChainByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState()).toMatchObject({
      availableChainRefs: [MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef],
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });
    await expect(port.get()).resolves.toMatchObject({
      selectedNamespace: "eip155",
      selectedChainRef: ALT_CHAIN.chainRef,
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
      rpc: {
        [ALT_CHAIN.chainRef]: { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });
  });

  it("repairs selectedChainRef when registry removes the current chain", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([{ metadata: MAINNET_CHAIN }, { metadata: ALT_CHAIN }]);
    const { service } = createPreferencesService({
      id: "network-preferences",
      selectedChainRef: MAINNET_CHAIN.chainRef,
      activeChainByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      rpc: {},
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      preferencesDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        selectedChainRef: MAINNET_CHAIN.chainRef,
        activeChainByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
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

    await bootstrap.flushPendingSync();
    expect(network.getState().availableChainRefs).toEqual([ALT_CHAIN.chainRef]);
    expect(chainViews.getSelectedChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });
    expect(service.getSelectedNamespace()).toBe("eip155");
    expect(service.getSelectedChainRef()).toBe(ALT_CHAIN.chainRef);
    bootstrap.destroy();
  });

  it("repairs unavailable selectedChainRef using the resolved provider chain for the same namespace", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const chainDefinitions = createChainDefinitionsStub([{ metadata: ALT_CHAIN }]);
    const { port, service } = createPreferencesService({
      id: "network-preferences",
      selectedChainRef: MAINNET_CHAIN.chainRef,
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
      rpc: {},
      updatedAt: 10,
    });

    const bootstrap = createNetworkBootstrap({
      network,
      chainDefinitions,
      preferences: service,
      preferencesDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        selectedChainRef: MAINNET_CHAIN.chainRef,
        activeChainByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState().availableChainRefs).toEqual([ALT_CHAIN.chainRef]);
    await expect(port.get()).resolves.toMatchObject({
      selectedNamespace: "eip155",
      selectedChainRef: ALT_CHAIN.chainRef,
      activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
    });
  });
});
