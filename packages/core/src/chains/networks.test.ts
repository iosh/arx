import { describe, expect, it, vi } from "vitest";
import type { ChainRef } from "../networks/chainRef.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { loadNetworksBootstrap } from "./bootstrap.js";
import type { ChainDefinitionSeed, RpcEndpoint } from "./definition.js";
import { createNetworks, type NetworksChanged } from "./networks.js";
import type { ChainRpcOverrideRecord, CustomChainRecord, WalletChainSelectionRecord } from "./persistence.js";

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
  createAt: 1,
});

type State = {
  customChains: Map<ChainRef, CustomChainRecord>;
  overrides: Map<ChainRef, ChainRpcOverrideRecord>;
  walletSelection: WalletChainSelectionRecord | null;
};

const createState = (): State => ({
  customChains: new Map(),
  overrides: new Map(),
  walletSelection: null,
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
  const changes: NetworksChanged[] = [];
  const networks = createNetworks({
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
    now: () => 100,
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
    await networks.addCustomChain(record);

    expect(commits).toHaveLength(1);
    expect(commits[0]?.[0]).toMatchObject({
      persistenceType: "customChain",
      operation: "put",
      value: { definition: record.definition, defaultRpcEndpoints: record.defaultRpcEndpoints, createAt: 100 },
    });
    expect(networks.getRpcEndpoints("eip155:10")[0].url).toBe("https://optimism.example");
  });

  it("updates an existing custom chain while preserving its creation time", async () => {
    const state = createState();
    state.customChains.set("eip155:10", customChain("eip155:10", "Optimism", "https://old.example"));
    const { networks, commits } = createHarness({ state });

    await networks.updateCustomChain(customChain("eip155:10", "OP Mainnet", "https://new.example"));

    expect(commits[0]?.[0]).toMatchObject({
      persistenceType: "customChain",
      operation: "put",
      value: { createAt: 1, definition: { displayName: "OP Mainnet" } },
    });
    expect(networks.getRpcEndpoints("eip155:10")[0].url).toBe("https://new.example");
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

  it("removes a custom chain and its RPC override without changing other owners", async () => {
    const state = createState();
    const record = customChain("eip155:10", "Optimism", "https://optimism.example");
    state.customChains.set("eip155:10", record);
    state.overrides.set("eip155:10", {
      chainRef: "eip155:10",
      endpoints: [endpoint("https://override.example")],
    });
    const { networks, commits } = createHarness({ state });

    await networks.removeCustomChain("eip155:10");

    expect(commits).toHaveLength(1);
    expect(commits[0]?.map((change) => `${change.persistenceType}:${change.operation}`)).toEqual([
      "customChain:remove",
      "chainRpcOverride:remove",
    ]);
    expect(networks.getChain("eip155:10")).toBeNull();
  });

  it("rejects removal of the selected custom chain", async () => {
    const state = createState();
    state.customChains.set("eip155:10", customChain("eip155:10", "Optimism", "https://optimism.example"));
    const { networks, commits } = createHarness({
      state,
      walletSelection: { activeNamespace: "eip155", chainRefByNamespace: { eip155: "eip155:10" } },
    });

    await expect(networks.removeCustomChain("eip155:10")).rejects.toMatchObject({
      code: "chain.custom_removal_rejected",
      details: { chainRef: "eip155:10", reason: "wallet_selected" },
    });
    expect(commits).toHaveLength(0);
  });
});
