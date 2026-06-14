import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../chains/metadata.js";
import { ChainRpcService } from "../../chains/rpc/ChainRpcService.js";
import { CHAIN_RPC_TOPICS } from "../../chains/rpc/topics.js";
import { InMemorySupportedChainsService } from "../../chains/runtime/supportedChains/SupportedChainsService.js";
import { SUPPORTED_CHAINS_TOPICS } from "../../chains/runtime/supportedChains/topics.js";
import { Messenger } from "../../messenger/Messenger.js";
import { createChainViewsService } from "../../services/runtime/chainViews/index.js";
import { createChainRpcDefaultEndpointsService } from "../../services/store/chainRpcDefaultEndpoints/ChainRpcDefaultEndpointsService.js";
import { createChainRpcEndpointOverridesService } from "../../services/store/chainRpcEndpointOverrides/ChainRpcEndpointOverridesService.js";
import { createWalletChainSelectionService } from "../../services/store/walletChainSelection/WalletChainSelectionService.js";
import type { WalletChainSelectionRecord } from "../../storage/records.js";
import {
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryCustomChainsPort,
  MemoryWalletChainSelectionPort,
} from "../__fixtures__/backgroundTestSetup.js";
import { createChainRpcBootstrap } from "./chainRpcBootstrap.js";

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

const createChainRpcService = () => {
  const bus = new Messenger();
  return new ChainRpcService({
    messenger: bus.scope({ publish: CHAIN_RPC_TOPICS }),
    initialAccesses: [],
  });
};

const createSelectionService = (
  seed: WalletChainSelectionRecord | null,
  defaults = {
    selectedNamespace: MAINNET_CHAIN.namespace,
    chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
  },
  now = () => 1_000,
) => {
  const port = new MemoryWalletChainSelectionPort(seed);
  const service = createWalletChainSelectionService({
    port,
    defaults,
    now,
  });
  return { port, service };
};

const createChainRpcEndpointOverrides = (
  seed: ConstructorParameters<typeof MemoryChainRpcEndpointOverridesPort>[0] = [],
  now = () => 1_000,
) => {
  const port = new MemoryChainRpcEndpointOverridesPort(seed);
  const service = createChainRpcEndpointOverridesService({
    port,
    now,
  });
  return { port, service };
};

const createChainRpcDefaultEndpoints = (
  seed: ConstructorParameters<typeof MemoryChainRpcDefaultEndpointsPort>[0] = [],
  now = () => 1_000,
) => {
  const port = new MemoryChainRpcDefaultEndpointsPort(seed);
  const service = createChainRpcDefaultEndpointsService({
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
  const supportedChains = new InMemorySupportedChainsService({
    messenger: bus.scope({ publish: SUPPORTED_CHAINS_TOPICS }),
    port: new MemoryCustomChainsPort((params.custom ?? []).map(toCustomChainRecord)),
    seed: params.builtin ?? [],
    now: () => 0,
  });
  await supportedChains.whenReady();
  return supportedChains;
};

describe("chainRpcBootstrap", () => {
  it("mounts only registered namespace chains, applies custom RPC, and repairs stored selection", async () => {
    const chainRpc = createChainRpcService();
    const supportedChains = await createSupportedChains({
      builtin: [MAINNET_CHAIN, ALT_CHAIN, SOLANA_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: SOLANA_CHAIN.namespace,
      chainRefByNamespace: {
        eip155: ALT_CHAIN.chainRef,
        solana: SOLANA_CHAIN.chainRef,
      },
      updatedAt: 10,
    });
    const { port: chainRpcEndpointOverridesPort, service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides(
      [
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
      ],
    );
    const { port: chainRpcDefaultEndpointsPort, service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints([
      {
        chainRef: SOLANA_CHAIN.chainRef,
        rpcEndpoints: SOLANA_CHAIN.rpcEndpoints,
        updatedAt: 10,
      },
    ]);

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      supportedChains,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      endpointOverrides: chainRpcEndpointOverrides,
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

    expect(chainRpc.listChainRefs()).toEqual([MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(chainRpc.getEndpoints(ALT_CHAIN.chainRef)[0].url).toBe("https://rpc.optimism.custom.example");
    expect(chainRpcDefaultEndpointsPort.upserted.map((record) => record.chainRef).sort()).toEqual([
      MAINNET_CHAIN.chainRef,
      ALT_CHAIN.chainRef,
    ]);
    expect(chainRpcDefaultEndpointsPort.removed).toContain(SOLANA_CHAIN.chainRef);
    await expect(selectionPort.get()).resolves.toEqual({
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
    expect(chainRpcEndpointOverridesPort.removed).toContain(SOLANA_CHAIN.chainRef);
  });

  it("repairs the selected UI chain when supported chains remove the current chain", async () => {
    const chainRpc = createChainRpcService();
    const supportedChains = await createSupportedChains({
      custom: [MAINNET_CHAIN, ALT_CHAIN],
    });
    const { service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints();
    const { service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides();

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      supportedChains,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      endpointOverrides: chainRpcEndpointOverrides,
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
      chainRpc,
      selection,
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();
    bootstrap.start();

    await supportedChains.removeChain(MAINNET_CHAIN.chainRef);
    await bootstrap.flushPendingSync();

    expect(chainRpc.listChainRefs()).toEqual([ALT_CHAIN.chainRef]);
    expect(chainViews.getSelectedChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });
    expect(selection.getSelectedNamespace()).toBe("eip155");
    expect(selection.getSelectedChainRef("eip155")).toBe(ALT_CHAIN.chainRef);
  });

  it("repairs the selected namespace chain using the resolved active chain for the same namespace", async () => {
    const chainRpc = createChainRpcService();
    const supportedChains = await createSupportedChains({
      custom: [ALT_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: MAINNET_CHAIN.namespace,
      chainRefByNamespace: { eip155: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints();
    const { service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides();

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      supportedChains,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      endpointOverrides: chainRpcEndpointOverrides,
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

    expect(chainRpc.listChainRefs()).toEqual([ALT_CHAIN.chainRef]);
    await expect(selectionPort.get()).resolves.toEqual({
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
  });

  it("flushes a sync requested during hydration after hydration ends", async () => {
    let isHydrating = true;
    const chainRpc = createChainRpcService();
    const supportedChains = await createSupportedChains({
      builtin: [MAINNET_CHAIN],
    });
    const { service: selection } = createSelectionService(null);
    const { service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints();
    const { service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides();

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      supportedChains,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      endpointOverrides: chainRpcEndpointOverrides,
      selectionDefaults: {
        selectedNamespace: MAINNET_CHAIN.namespace,
        chainRefByNamespace: { [MAINNET_CHAIN.namespace]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      logger: () => {},
      getIsHydrating: () => isHydrating,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadPreferences();
    bootstrap.requestSync();
    await bootstrap.flushPendingSync();
    expect(chainRpc.listChainRefs()).toEqual([]);

    isHydrating = false;
    await bootstrap.flushPendingSync();

    expect(chainRpc.listChainRefs()).toEqual([MAINNET_CHAIN.chainRef]);
  });
});
