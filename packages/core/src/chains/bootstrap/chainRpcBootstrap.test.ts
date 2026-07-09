import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessenger } from "../../messenger/index.js";
import {
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryWalletChainSelectionPort,
} from "../../runtime/__fixtures__/backgroundTestSetup.js";
import { CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION } from "../../storage/index.js";
import type { WalletChainSelectionRecord } from "../../storage/records.js";
import { getChainRefNamespace } from "../caip.js";
import { type ChainDefinition, cloneChainDefinition, type RpcEndpoint } from "../definition.js";
import { InMemoryChainDefinitionsService } from "../definitions/ChainDefinitionsService.js";
import { ChainRpcService } from "../rpc/ChainRpcService.js";
import { createChainRpcDefaultEndpointsService } from "../rpc/defaultEndpoints/ChainRpcDefaultEndpointsService.js";
import { createChainRpcEndpointOverridesService } from "../rpc/endpointOverrides/ChainRpcEndpointOverridesService.js";
import { createWalletChainSelectionService } from "../selection/wallet/WalletChainSelectionService.js";
import { createChainViewsService } from "../views/index.js";
import { createChainRpcBootstrap } from "./chainRpcBootstrap.js";

type TestChain = ChainDefinition & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const MAINNET_CHAIN: TestChain = {
  chainRef: "eip155:1",
  displayName: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.mainnet.example", type: "public" }],
};

const ALT_CHAIN: TestChain = {
  chainRef: "eip155:10",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
};

const SOLANA_CHAIN: TestChain = {
  chainRef: "solana:101",
  displayName: "Solana",
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  defaultRpcEndpoints: [{ url: "https://rpc.solana.example", type: "public" }],
};

const EIP155_NAMESPACE = "eip155";
const SOLANA_NAMESPACE = "solana";

const toDefaultEndpointSeed = (chain: TestChain) => ({
  chainRef: chain.chainRef,
  rpcEndpoints: [...chain.defaultRpcEndpoints],
  source: "bundle" as const,
});

const toDefaultEndpointRecord = (chain: TestChain, updatedAt = 10) => ({
  ...toDefaultEndpointSeed(chain),
  source: "request" as const,
  updatedAt,
});

const createChainRpcService = () => {
  const messenger = createMessenger();
  return new ChainRpcService({
    messenger,
    initialAccesses: [],
  });
};

const createSelectionService = (
  seed: WalletChainSelectionRecord | null,
  defaults = {
    selectedNamespace: EIP155_NAMESPACE,
    chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
  },
  now = () => 1_000,
): { port: MemoryWalletChainSelectionPort; service: ReturnType<typeof createWalletChainSelectionService> } => {
  const port = new MemoryWalletChainSelectionPort(seed);
  const service = createWalletChainSelectionService({
    messenger: createMessenger(),
    port,
    defaults,
    now,
  });
  return { port, service };
};

const createChainRpcEndpointOverrides = (
  seed: ConstructorParameters<typeof MemoryChainRpcEndpointOverridesPort>[0] = [],
  now = () => 1_000,
): {
  port: MemoryChainRpcEndpointOverridesPort;
  service: ReturnType<typeof createChainRpcEndpointOverridesService>;
} => {
  const port = new MemoryChainRpcEndpointOverridesPort(seed);
  const service = createChainRpcEndpointOverridesService({
    messenger: createMessenger(),
    port,
    now,
  });
  return { port, service };
};

const createChainRpcDefaultEndpoints = (
  seed: ConstructorParameters<typeof MemoryChainRpcDefaultEndpointsPort>[0] = [],
  now = () => 1_000,
): {
  port: MemoryChainRpcDefaultEndpointsPort;
  service: ReturnType<typeof createChainRpcDefaultEndpointsService>;
} => {
  const port = new MemoryChainRpcDefaultEndpointsPort(seed);
  const service = createChainRpcDefaultEndpointsService({
    messenger: createMessenger(),
    port,
    now,
  });
  return { port, service };
};

const toCustomChainDefinition = (chain: TestChain) => ({
  chainRef: chain.chainRef,
  namespace: getChainRefNamespace(chain.chainRef),
  definition: cloneChainDefinition(chain),
  schemaVersion: CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  source: "custom" as const,
  updatedAt: 0,
});

const createChainDefinitions = async (params: { builtin?: TestChain[]; custom?: TestChain[] }) => {
  const messenger = createMessenger();
  const chainDefinitions = new InMemoryChainDefinitionsService({
    messenger,
    port: new MemoryChainDefinitionsPort((params.custom ?? []).map(toCustomChainDefinition)),
    seed: (params.builtin ?? []).map((chain) => cloneChainDefinition(chain)),
    now: () => 0,
  });
  await chainDefinitions.whenReady();
  return chainDefinitions;
};

describe("chainRpcBootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts only registered namespace chains, applies custom RPC, and repairs stored selection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const chainRpc = createChainRpcService();
    const chainDefinitions = await createChainDefinitions({
      builtin: [MAINNET_CHAIN, ALT_CHAIN, SOLANA_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: SOLANA_NAMESPACE,
      chainRefByNamespace: {
        [EIP155_NAMESPACE]: ALT_CHAIN.chainRef,
        [SOLANA_NAMESPACE]: SOLANA_CHAIN.chainRef,
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
        rpcEndpoints: SOLANA_CHAIN.defaultRpcEndpoints,
        source: "request",
        updatedAt: 10,
      },
    ]);

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      chainDefinitions,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      defaultEndpointSeeds: [MAINNET_CHAIN, ALT_CHAIN, SOLANA_CHAIN].map(toDefaultEndpointSeed),
      endpointOverrides: chainRpcEndpointOverrides,
      selectionDefaults: {
        selectedNamespace: EIP155_NAMESPACE,
        chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadStoredChainState();
    bootstrap.refreshChainRpcAccesses();
    await bootstrap.cleanStoredChainState();

    expect(chainRpc.listChainRefs()).toEqual([MAINNET_CHAIN.chainRef, ALT_CHAIN.chainRef]);
    expect(chainRpc.getEndpoints(ALT_CHAIN.chainRef)[0].url).toBe("https://rpc.optimism.custom.example");
    expect(chainRpcDefaultEndpointsPort.upserted.map((record) => record.chainRef).sort()).toEqual([
      MAINNET_CHAIN.chainRef,
      ALT_CHAIN.chainRef,
    ]);
    await expect(selectionPort.get()).resolves.toEqual({
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
    expect(chainRpcEndpointOverridesPort.removed).toContain(SOLANA_CHAIN.chainRef);
  });

  it("repairs the selected UI chain when chain definitions remove the current chain", async () => {
    const chainRpc = createChainRpcService();
    const chainDefinitions = await createChainDefinitions({
      custom: [MAINNET_CHAIN, ALT_CHAIN],
    });
    const { service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: EIP155_NAMESPACE,
      chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints([
      toDefaultEndpointRecord(MAINNET_CHAIN),
      toDefaultEndpointRecord(ALT_CHAIN),
    ]);
    const { service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides();

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      chainDefinitions,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      defaultEndpointSeeds: [],
      endpointOverrides: chainRpcEndpointOverrides,
      selectionDefaults: {
        selectedNamespace: EIP155_NAMESPACE,
        chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });
    const chainViews = createChainViewsService({
      chainDefinitions,
      chainRpc,
      selection,
    });

    await bootstrap.loadStoredChainState();
    bootstrap.refreshChainRpcAccesses();
    await bootstrap.cleanStoredChainState();
    bootstrap.start();

    await chainDefinitions.removeCustomChain(MAINNET_CHAIN.chainRef);
    await bootstrap.cleanStoredChainState();

    expect(chainRpc.listChainRefs()).toEqual([ALT_CHAIN.chainRef]);
    expect(chainViews.getSelectedChainView()).toMatchObject({ chainRef: ALT_CHAIN.chainRef });
    expect(selection.getSelectedNamespace()).toBe("eip155");
    expect(selection.getSelectedChainRef("eip155")).toBe(ALT_CHAIN.chainRef);
  });

  it("repairs the selected namespace chain using the resolved active chain for the same namespace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const chainRpc = createChainRpcService();
    const chainDefinitions = await createChainDefinitions({
      custom: [ALT_CHAIN],
    });
    const { port: selectionPort, service: selection } = createSelectionService({
      id: "wallet-chain-selection",
      selectedNamespace: EIP155_NAMESPACE,
      chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
      updatedAt: 10,
    });
    const { service: chainRpcDefaultEndpoints } = createChainRpcDefaultEndpoints([toDefaultEndpointRecord(ALT_CHAIN)]);
    const { service: chainRpcEndpointOverrides } = createChainRpcEndpointOverrides();

    const bootstrap = createChainRpcBootstrap({
      chainRpcAccessUpdater: chainRpc,
      chainDefinitions,
      selection,
      defaultEndpoints: chainRpcDefaultEndpoints,
      defaultEndpointSeeds: [],
      endpointOverrides: chainRpcEndpointOverrides,
      selectionDefaults: {
        selectedNamespace: EIP155_NAMESPACE,
        chainRefByNamespace: { [EIP155_NAMESPACE]: MAINNET_CHAIN.chainRef },
      },
      hydrationEnabled: true,
      getIsHydrating: () => false,
      getRegisteredNamespaces: () => new Set(["eip155"]),
    });

    await bootstrap.loadStoredChainState();
    bootstrap.refreshChainRpcAccesses();
    await bootstrap.cleanStoredChainState();

    expect(chainRpc.listChainRefs()).toEqual([ALT_CHAIN.chainRef]);
    await expect(selectionPort.get()).resolves.toEqual({
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
      updatedAt: 1_000,
    });
  });
});
