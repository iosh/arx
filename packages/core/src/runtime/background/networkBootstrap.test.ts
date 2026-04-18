import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { buildNetworkRuntimeInput } from "../../controllers/network/config.js";
import { InMemoryNetworkController } from "../../controllers/network/NetworkController.js";
import { NETWORK_TOPICS } from "../../controllers/network/topics.js";
import { InMemorySupportedChainsController } from "../../controllers/supportedChains/SupportedChainsController.js";
import { SUPPORTED_CHAINS_TOPICS } from "../../controllers/supportedChains/topics.js";
import { Messenger } from "../../messenger/Messenger.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createCustomRpcService } from "../../services/store/customRpc/CustomRpcService.js";
import { createNetworkSelectionService } from "../../services/store/networkSelection/NetworkSelectionService.js";
import type { NetworkSelectionRecord } from "../../storage/records.js";
import {
  MemoryCustomChainsPort,
  MemoryCustomRpcPort,
  MemoryNetworkSelectionPort,
} from "../__fixtures__/backgroundTestSetup.js";
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

const createSelectionService = (
  seed: NetworkSelectionRecord | null,
  defaults = {
    selectedNamespace: MAINNET_CHAIN.namespace,
    chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
  },
  now = () => 1_000,
) => {
  const port = new MemoryNetworkSelectionPort(seed);
  const service = createNetworkSelectionService({
    port,
    defaults,
    now,
  });
  return { port, service };
};

const createCustomRpc = (seed: ConstructorParameters<typeof MemoryCustomRpcPort>[0] = [], now = () => 1_000) => {
  const port = new MemoryCustomRpcPort(seed);
  const service = createCustomRpcService({
    port,
    now,
  });
  return { port, service };
};

const toCustomChainRecord = (metadata: ChainMetadata) => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  updatedAt: 0,
});

const createSupportedChains = async (params: { builtin?: ChainMetadata[]; custom?: ChainMetadata[] }) => {
  const bus = new Messenger();
  const controller = new InMemorySupportedChainsController({
    messenger: bus.scope({ publish: SUPPORTED_CHAINS_TOPICS }),
    port: new MemoryCustomChainsPort((params.custom ?? []).map(toCustomChainRecord)),
    seed: params.builtin ?? [],
    now: () => 0,
  });
  await controller.whenReady();
  return controller;
};

describe("networkBootstrap", () => {
  it("mounts only registered namespace chains, applies custom RPC, and repairs stored selection", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const supportedChains = await createSupportedChains({
      builtin: [MAINNET_CHAIN, ALT_CHAIN, SOLANA_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "network-selection",
      selectedNamespace: SOLANA_CHAIN.namespace,
      chainRefByNamespace: {
        eip155: ALT_CHAIN.chainRef,
        solana: SOLANA_CHAIN.chainRef,
      },
      updatedAt: 10,
    });
    const { port: customRpcPort, service: customRpc } = createCustomRpc([
      {
        chainRef: ALT_CHAIN.chainRef,
        rpcEndpoints: [{ url: "https://rpc.optimism.custom.example", type: "authenticated" }],
        updatedAt: 10,
      },
      {
        chainRef: SOLANA_CHAIN.chainRef,
        rpcEndpoints: [{ url: "https://rpc.solana.custom.example", type: "public" }],
        updatedAt: 10,
      },
    ]);

    const bootstrap = createNetworkBootstrap({
      network,
      supportedChains,
      selection,
      customRpc,
      selectionDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();

    expect(network.getState().availableChainRefs).toEqual([MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(network.getActiveEndpoint(ALT_CHAIN.chainRef).url).toBe("https://rpc.optimism.custom.example");
    await expect(selectionPort.get()).resolves.toEqual({
      id: "network-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
    expect(customRpcPort.removed).toContain(SOLANA_CHAIN.chainRef);
  });

  it("repairs the selected UI chain when supported chains remove the current chain", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const supportedChains = await createSupportedChains({
      custom: [MAINNET_CHAIN, ALT_CHAIN],
    });
    const { service: selection } = createSelectionService({
      id: "network-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: customRpc } = createCustomRpc();

    const bootstrap = createNetworkBootstrap({
      network,
      supportedChains,
      selection,
      customRpc,
      selectionDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });
    const chainViews = createChainViewsService({
      supportedChains,
      network,
      selection,
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();
    bootstrap.start();

    await supportedChains.removeChain(MAINNET_CHAIN.chainRef);
    await bootstrap.flushPendingSync();

    expect(network.getState().availableChainRefs).toEqual([ALT_CHAIN.chainRef]);
    expect(chainViews.getSelectedChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });
    expect(selection.getSelectedNamespace()).toBe("eip155");
    expect(selection.getSelectedChainRef("eip155")).toBe(ALT_CHAIN.chainRef);
    bootstrap.destroy();
  });

  it("repairs the selected namespace chain using the resolved active chain for the same namespace", async () => {
    const network = createNetworkController(MAINNET_CHAIN);
    const supportedChains = await createSupportedChains({
      custom: [ALT_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "network-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: customRpc } = createCustomRpc();

    const bootstrap = createNetworkBootstrap({
      network,
      supportedChains,
      selection,
      customRpc,
      selectionDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
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
    await expect(selectionPort.get()).resolves.toEqual({
      id: "network-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
  });
});
