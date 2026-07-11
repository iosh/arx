import { describe, expect, it, vi } from "vitest";
import type { PermissionRecord } from "../permissions/persistence.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "./definition.js";
import type { CustomChainRecord } from "./definitions/persistence.js";
import type { ChainRef } from "./ids.js";
import { createNetworks, type NetworksChanged, type NetworksContext } from "./Networks.js";
import { loadNetworksBootstrap } from "./networkBootstrap.js";
import type { ChainRpcOverrideRecord } from "./rpc/endpointOverrides/persistence.js";
import type { ProviderChainSelectionRecord } from "./selection/provider/persistence.js";
import type { WalletChainSelectionRecord } from "./selection/wallet/persistence.js";

const endpoint = (url: string): RpcEndpoint => ({ url, type: "public" });

const chain = (chainRef: ChainRef, displayName: string, rpcUrl: string): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: {
    chainRef,
    displayName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: [endpoint(rpcUrl)],
});

const customChain = (chainRef: ChainRef, displayName: string, rpcUrl: string): CustomChainRecord => ({
  definition: {
    chainRef,
    displayName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: [endpoint(rpcUrl)],
});

type State = {
  customChains: Map<ChainRef, CustomChainRecord>;
  overrides: Map<ChainRef, ChainRpcOverrideRecord>;
  walletSelection: WalletChainSelectionRecord | null;
  providerSelections: Map<string, ProviderChainSelectionRecord>;
  permissions: Map<string, PermissionRecord>;
  hasActiveTransaction: boolean;
};

const providerKey = (value: { origin: string; namespace: string }): string => `${value.origin}\u0000${value.namespace}`;

const createState = (): State => ({
  customChains: new Map(),
  overrides: new Map(),
  walletSelection: null,
  providerSelections: new Map(),
  permissions: new Map(),
  hasActiveTransaction: false,
});

const applyChanges = (state: State, changes: readonly PersistenceChange[]): void => {
  for (const change of changes) {
    switch (change.persistenceType) {
      case "customChain":
        if (change.operation === "put") state.customChains.set(change.value.definition.chainRef, change.value);
        else state.customChains.delete(change.key);
        break;
      case "chainRpcOverride":
        if (change.operation === "put") state.overrides.set(change.value.chainRef, change.value);
        else state.overrides.delete(change.key);
        break;
      case "walletChainSelection":
        state.walletSelection = change.operation === "put" ? change.value : null;
        break;
      case "providerChainSelection":
        if (change.operation === "put") state.providerSelections.set(providerKey(change.value), change.value);
        else state.providerSelections.delete(providerKey(change.key));
        break;
      case "permission":
        if (change.operation === "put") state.permissions.set(providerKey(change.value), change.value);
        else state.permissions.delete(providerKey(change.key));
        break;
    }
  }
};

const createHarness = (
  params: {
    state?: State;
    builtinSeeds?: readonly ChainDefinitionSeed<RpcEndpoint>[];
    walletSelection?: WalletChainSelectionRecord;
  } = {},
) => {
  const state = params.state ?? createState();
  const commits: readonly PersistenceChange[][] = [];
  const readers: NetworksContext["readers"] = {
    providerChainSelections: {
      get: vi.fn(async (key) => state.providerSelections.get(providerKey(key)) ?? null),
      listByOrigin: vi.fn(async (origin) =>
        [...state.providerSelections.values()].filter((record) => record.origin === origin),
      ),
      listByChainRef: vi.fn(async (chainRef) =>
        [...state.providerSelections.values()].filter((record) => record.chainRef === chainRef),
      ),
      listAll: vi.fn(async () => [...state.providerSelections.values()]),
    },
    permissions: {
      get: vi.fn(async (key) => state.permissions.get(providerKey(key)) ?? null),
      listByOrigin: vi.fn(async (origin) =>
        [...state.permissions.values()].filter((record) => record.origin === origin),
      ),
      listReferencingAccountIds: vi.fn(async () => []),
      listReferencingChainRef: vi.fn(async (chainRef) =>
        [...state.permissions.values()].filter((record) => chainRef in record.chainScopes),
      ),
      listAll: vi.fn(async () => [...state.permissions.values()]),
    },
    transactions: {
      get: vi.fn(async () => null),
      listHistory: vi.fn(async () => ({ transactions: [] })),
      listByConflictKey: vi.fn(async () => []),
      listByStatuses: vi.fn(async () => []),
      existsByChainRefAndStatuses: vi.fn(async () => state.hasActiveTransaction),
      listIds: vi.fn(async () => []),
    },
  };
  const changes: NetworksChanged[] = [];
  const networks = createNetworks({
    readers,
    mutations: createCoreMutationQueue({
      commit: vi.fn(async (next) => {
        (commits as PersistenceChange[][]).push([...next]);
        applyChanges(state, next);
      }),
    }),
    bootstrap: {
      builtinSeeds: params.builtinSeeds ?? [chain("eip155:1", "Ethereum", "https://builtin.example")],
      customChains: [...state.customChains.values()],
      rpcOverrides: [...state.overrides.values()],
      walletSelection: params.walletSelection ?? {
        activeNamespace: "eip155",
        chainRefByNamespace: { eip155: "eip155:1" },
      },
    },
    publishChanged: (change) => changes.push(change),
  });
  return { networks, state, commits, changes };
};

describe("Networks", () => {
  it("loads custom chains, overrides, and wallet selection together", async () => {
    const custom = customChain("eip155:10", "Optimism", "https://optimism.example");
    const override: ChainRpcOverrideRecord = {
      chainRef: "eip155:1",
      endpoints: [endpoint("https://override.example")],
    };
    const bootstrap = await loadNetworksBootstrap({
      readers: {
        customChains: { listAll: async () => [custom] },
        chainRpcOverrides: { listAll: async () => [override] },
        walletChainSelection: {
          get: async () => ({ activeNamespace: "eip155", chainRefByNamespace: { eip155: "eip155:10" } }),
        },
      },
      builtinSeeds: [chain("eip155:1", "Ethereum", "https://builtin.example")],
      walletSelectionDefaults: {
        activeNamespace: "eip155",
        chainRefByNamespace: { eip155: "eip155:1", solana: "solana:mainnet" },
      },
    });

    expect(bootstrap.customChains).toEqual([custom]);
    expect(bootstrap.rpcOverrides).toEqual([override]);
    expect(bootstrap.walletSelection.chainRefByNamespace).toEqual({
      eip155: "eip155:10",
      solana: "solana:mainnet",
    });
  });

  it("stores a custom definition and its default endpoints as one record", async () => {
    const { networks, commits } = createHarness();
    const record = customChain("eip155:10", "Optimism", "https://optimism.example");
    await networks.setCustomChain(record);

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual([{ persistenceType: "customChain", operation: "put", value: record }]);
    expect(networks.getRpcEndpoints("eip155:10")[0].url).toBe("https://optimism.example");
  });

  it("lists builtin chains before custom chains", async () => {
    const state = createState();
    state.customChains.set("eip155:10", customChain("eip155:10", "Optimism", "https://optimism.example"));
    const { networks } = createHarness({
      state,
      builtinSeeds: [
        chain("eip155:137", "Polygon", "https://polygon.example"),
        chain("eip155:1", "Ethereum", "https://ethereum.example"),
      ],
    });

    expect(networks.listChains().map(({ definition, source }) => [definition.chainRef, source])).toEqual([
      ["eip155:1", "builtin"],
      ["eip155:137", "builtin"],
      ["eip155:10", "custom"],
    ]);
  });

  it("uses an RPC override before chain defaults", async () => {
    const { networks } = createHarness();
    await networks.setRpcOverride({
      chainRef: "eip155:1",
      endpoints: [endpoint("https://override.example")],
    });
    expect(networks.getRpcEndpoints("eip155:1")[0].url).toBe("https://override.example");

    await networks.clearRpcOverride("eip155:1");
    expect(networks.getRpcEndpoints("eip155:1")[0].url).toBe("https://builtin.example");
  });

  it("removes a custom chain and all durable references in one commit", async () => {
    const state = createState();
    const record = customChain("eip155:10", "Optimism", "https://optimism.example");
    state.customChains.set("eip155:10", record);
    state.overrides.set("eip155:10", {
      chainRef: "eip155:10",
      endpoints: [endpoint("https://override.example")],
    });
    state.providerSelections.set("https://app.example\u0000eip155", {
      origin: "https://app.example",
      namespace: "eip155",
      chainRef: "eip155:10",
    });
    state.permissions.set("https://app.example\u0000eip155", {
      origin: "https://app.example",
      namespace: "eip155",
      chainScopes: { "eip155:1": [], "eip155:10": [] },
    });
    const { networks, commits } = createHarness({ state });

    await networks.removeCustomChain("eip155:10");

    expect(commits).toHaveLength(1);
    expect(commits[0]?.map((change) => `${change.persistenceType}:${change.operation}`)).toEqual([
      "customChain:remove",
      "chainRpcOverride:remove",
      "providerChainSelection:remove",
      "permission:put",
    ]);
    expect(state.permissions.get("https://app.example\u0000eip155")?.chainScopes).toEqual({ "eip155:1": [] });
    expect(networks.getChain("eip155:10")).toBeNull();
  });

  it("rejects custom-chain removal while an active transaction references it", async () => {
    const state = createState();
    state.customChains.set("eip155:10", customChain("eip155:10", "Optimism", "https://optimism.example"));
    state.hasActiveTransaction = true;
    const { networks, commits } = createHarness({ state });

    await expect(networks.removeCustomChain("eip155:10")).rejects.toMatchObject({
      code: "chain.custom_removal_rejected",
      details: { chainRef: "eip155:10", reason: "active_transaction" },
    });
    expect(commits).toHaveLength(0);
  });

  it("initializes a missing provider selection from the wallet selection", async () => {
    const { networks, commits } = createHarness();
    const selection = await networks.initializeProviderChainSelection({
      origin: "https://app.example",
      namespace: "eip155",
    });

    expect(selection).toEqual({
      origin: "https://app.example",
      namespace: "eip155",
      chainRef: "eip155:1",
    });
    expect(commits[0]).toEqual([{ persistenceType: "providerChainSelection", operation: "put", value: selection }]);
  });
});
