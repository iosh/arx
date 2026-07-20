import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { NetworksBootstrap } from "./bootstrap.js";
import {
  BuiltinNetworkConflictError,
  BuiltinNetworkImmutableError,
  CustomNetworkAlreadyExistsError,
  NetworkRpcEndpointInvalidError,
  NetworkRpcEndpointMismatchError,
  NetworkSelectionMissingError,
} from "./errors.js";
import { Networks } from "./Networks.js";
import type { NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import type { CustomNetworkRecord, NetworkRpcOverrideRecord, NetworkSelectionRecord } from "./persistence.js";
import type { BuiltinNetworkSeed, NetworkSelectionChanged, NetworksChanged, NonEmptyRpcEndpoints } from "./types.js";

const networkSeed = (chainRef: string, name: string, endpoint: string): BuiltinNetworkSeed => ({
  definition: {
    chainRef,
    name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: [endpoint],
});

const ethereum = networkSeed("eip155:1", "Ethereum", "https://ethereum.example");
const solana = networkSeed("solana:mainnet", "Solana", "https://solana.example");
const custom: CustomNetworkRecord = {
  definition: {
    chainRef: "eip155:10",
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://optimism.example", "https://optimism-backup.example"],
};
const override: NetworkRpcOverrideRecord = {
  chainRef: "eip155:1",
  endpoints: ["https://ethereum-override.example"],
};

const queryEip155ChainRef = async (endpoint: string): Promise<string> => {
  if (endpoint.includes("optimism")) return "eip155:10";
  return "eip155:1";
};

const createAdapters = (queryChainRef: (endpoint: string) => Promise<string>): NetworksNamespaceAdapters => [
  {
    namespace: "eip155",
    builtinNetworks: [ethereum],
    defaultChainRef: "eip155:1",
    queryChainRef,
  },
  {
    namespace: "solana",
    builtinNetworks: [solana],
    defaultChainRef: "solana:mainnet",
    queryChainRef: async () => "solana:mainnet",
  },
];

const bootstrap = (selection: NetworkSelectionRecord | null = null): NetworksBootstrap => ({
  customNetworks: [custom],
  networkRpcOverrides: [override],
  selection,
});

const emptyBootstrap: NetworksBootstrap = {
  customNetworks: [],
  networkRpcOverrides: [],
  selection: null,
};

type NetworksChange = NetworksChanged | NetworkSelectionChanged;

const createNetworks = (
  options: {
    bootstrap?: NetworksBootstrap;
    queryChainRef?: (endpoint: string) => Promise<string>;
    commit?(changes: readonly PersistenceChange[]): Promise<void>;
  } = {},
) => {
  const commits: PersistenceChange[][] = [];
  const changes: NetworksChange[] = [];
  const queryChainRef = vi.fn(options.queryChainRef ?? queryEip155ChainRef);
  const commit =
    options.commit ??
    (async (persistenceChanges: readonly PersistenceChange[]) => {
      commits.push([...persistenceChanges]);
    });
  const networks = new Networks({
    adapters: createAdapters(queryChainRef),
    defaultNamespace: "eip155",
    bootstrap: options.bootstrap ?? bootstrap(),
    mutations: createCoreMutationQueue({ commit }),
    publishChanged: (change) => changes.push(change),
  });

  return { networks, commits, changes, queryChainRef };
};

describe("Networks", () => {
  it("serves installed state and uses explicit defaults only on first run", () => {
    const { networks } = createNetworks();

    expect(networks.get("eip155:1")).toEqual({
      chainRef: "eip155:1",
      namespace: "eip155",
      source: "builtin",
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    });
    expect(networks.listByNamespace("eip155").map((network) => network.chainRef)).toEqual(["eip155:1", "eip155:10"]);
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "override",
      endpoints: ["https://ethereum-override.example"],
      defaultEndpoints: ["https://ethereum.example"],
    });
    expect(networks.getSelection()).toEqual({
      selectedNamespace: "eip155",
      selectedChainRef: "eip155:1",
      selectedChainRefByNamespace: { eip155: "eip155:1", solana: "solana:mainnet" },
    });

    const stored = createNetworks({
      bootstrap: bootstrap({
        selectedNamespace: "solana",
        selectedChainRefByNamespace: { eip155: "eip155:10", solana: "solana:mainnet" },
      }),
    }).networks;
    expect(stored.getSelection()).toMatchObject({
      selectedNamespace: "solana",
      selectedChainRef: "solana:mainnet",
    });
  });

  it("rejects an incomplete stored selection instead of merging defaults", () => {
    expect(() =>
      createNetworks({
        bootstrap: bootstrap({
          selectedNamespace: "eip155",
          selectedChainRefByNamespace: { eip155: "eip155:10" },
        }),
      }),
    ).toThrow(NetworkSelectionMissingError);
  });

  it("adds and fully replaces custom networks while preserving no-op semantics", async () => {
    const { networks, commits, changes, queryChainRef } = createNetworks({ bootstrap: emptyBootstrap });

    await networks.addCustom(custom);
    expect(networks.get("eip155:10")).toMatchObject({ name: "Optimism", source: "custom" });
    expect(commits[0]).toEqual([{ persistenceType: "customNetwork", operation: "put", value: custom }]);
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: ["eip155:10"] }]);
    expect(networks.getSelection().selectedChainRef).toBe("eip155:1");
    expect(queryChainRef).toHaveBeenCalledTimes(2);

    await expect(networks.addCustom(custom)).rejects.toThrow(CustomNetworkAlreadyExistsError);
    await expect(
      networks.addCustom({ definition: ethereum.definition, defaultRpcEndpoints: ethereum.defaultRpcEndpoints }),
    ).rejects.toThrow(BuiltinNetworkConflictError);
    await networks.updateCustom(custom);
    expect(commits).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(queryChainRef).toHaveBeenCalledTimes(2);

    const updated = {
      definition: { ...custom.definition, name: "OP Mainnet" },
      defaultRpcEndpoints: ["https://optimism-v2.example"],
    } as const;
    await networks.updateCustom(updated);
    expect(networks.get("eip155:10")).toMatchObject({ name: "OP Mainnet" });
    expect(networks.getRpcEndpoints("eip155:10")).toEqual(updated.defaultRpcEndpoints);
    expect(commits).toHaveLength(2);
    expect(changes).toHaveLength(2);
    expect(queryChainRef).toHaveBeenCalledTimes(3);

    await expect(
      networks.updateCustom({ definition: ethereum.definition, defaultRpcEndpoints: ethereum.defaultRpcEndpoints }),
    ).rejects.toThrow(BuiltinNetworkImmutableError);
  });

  it("sets and clears RPC overrides only when configuration changes", async () => {
    const { networks, commits, changes, queryChainRef } = createNetworks({ bootstrap: emptyBootstrap });
    const endpoints: NonEmptyRpcEndpoints = ["https://ethereum-override.example"];

    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    await networks.setRpcOverride({ chainRef: "eip155:1", endpoints });
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "override",
      endpoints,
      defaultEndpoints: ["https://ethereum.example"],
    });
    expect(commits).toHaveLength(1);
    expect(changes).toEqual([{ type: "networksChanged", chainRefs: ["eip155:1"] }]);
    expect(queryChainRef).toHaveBeenCalledTimes(1);

    await networks.clearRpcOverride("eip155:1");
    await networks.clearRpcOverride("eip155:1");
    expect(networks.getRpcConfiguration("eip155:1")).toEqual({
      source: "default",
      endpoints: ["https://ethereum.example"],
    });
    expect(commits).toHaveLength(2);
    expect(commits[1]).toEqual([{ persistenceType: "networkRpcOverride", operation: "remove", key: "eip155:1" }]);
    expect(changes).toHaveLength(2);
  });

  it("persists complete wallet selection and reports affected namespaces", async () => {
    const { networks, commits, changes } = createNetworks();

    await networks.selectNetwork("eip155:10");
    await networks.selectNetwork("eip155:10");
    expect(networks.getSelection()).toEqual({
      selectedNamespace: "eip155",
      selectedChainRef: "eip155:10",
      selectedChainRefByNamespace: { eip155: "eip155:10", solana: "solana:mainnet" },
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]?.[0]).toMatchObject({
      persistenceType: "networkSelection",
      operation: "put",
      value: {
        selectedNamespace: "eip155",
        selectedChainRefByNamespace: { eip155: "eip155:10", solana: "solana:mainnet" },
      },
    });
    expect(changes).toEqual([{ type: "networkSelectionChanged", namespaces: ["eip155"] }]);

    await networks.selectNamespace("solana");
    await networks.selectNamespace("solana");
    expect(networks.getSelection()).toMatchObject({
      selectedNamespace: "solana",
      selectedChainRef: "solana:mainnet",
    });
    expect(commits).toHaveLength(2);
    expect(changes[1]).toEqual({
      type: "networkSelectionChanged",
      namespaces: ["eip155", "solana"],
    });
  });

  it("rejects endpoint admission failures and does not activate failed commits", async () => {
    const invalid = createNetworks({ bootstrap: emptyBootstrap });
    await expect(
      invalid.networks.addCustom({ ...custom, defaultRpcEndpoints: ["ws://optimism.example"] }),
    ).rejects.toThrow(NetworkRpcEndpointInvalidError);
    expect(invalid.queryChainRef).not.toHaveBeenCalled();

    const mismatch = createNetworks({
      bootstrap: emptyBootstrap,
      queryChainRef: async () => "eip155:1",
    });
    await expect(mismatch.networks.addCustom(custom)).rejects.toThrow(NetworkRpcEndpointMismatchError);

    const transportFailure = new Error("offline");
    const unavailable = createNetworks({
      bootstrap: emptyBootstrap,
      queryChainRef: async () => {
        throw transportFailure;
      },
    });
    await expect(unavailable.networks.addCustom(custom)).rejects.toBe(transportFailure);

    const commitFailure = new Error("commit failed");
    const failedCommit = createNetworks({
      bootstrap: emptyBootstrap,
      commit: async () => {
        throw commitFailure;
      },
    });
    await expect(failedCommit.networks.addCustom(custom)).rejects.toBe(commitFailure);
    expect(failedCommit.networks.get("eip155:10")).toBeNull();
    expect(failedCommit.changes).toEqual([]);
  });
});
