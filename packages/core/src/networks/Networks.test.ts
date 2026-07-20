import { describe, expect, it } from "vitest";
import type { NetworksBootstrap } from "./bootstrap.js";
import { NetworkSelectionMissingError } from "./errors.js";
import { Networks } from "./Networks.js";
import type { NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import type { CustomNetworkRecord, NetworkRpcOverrideRecord, NetworkSelectionRecord } from "./persistence.js";
import type { BuiltinNetworkSeed } from "./types.js";

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
  defaultRpcEndpoints: ["https://optimism.example"],
};
const override: NetworkRpcOverrideRecord = {
  chainRef: "eip155:1",
  endpoints: ["https://override.example"],
};
const adapters = [
  {
    namespace: "eip155",
    builtinNetworks: [ethereum],
    defaultChainRef: "eip155:1",
    queryChainRef: async () => "eip155:1",
  },
  {
    namespace: "solana",
    builtinNetworks: [solana],
    defaultChainRef: "solana:mainnet",
    queryChainRef: async () => "solana:mainnet",
  },
] as const satisfies NetworksNamespaceAdapters;

const bootstrap = (selection: NetworkSelectionRecord | null = null): NetworksBootstrap => ({
  customNetworks: [custom],
  networkRpcOverrides: [override],
  selection,
});

describe("Networks", () => {
  it("serves installed networks and RPC configuration from memory", () => {
    const networks = new Networks({ adapters, defaultNamespace: "eip155", bootstrap: bootstrap() });

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
      endpoints: ["https://override.example"],
      defaultEndpoints: ["https://ethereum.example"],
    });
    expect(networks.getRpcEndpoints("eip155:10")).toEqual(["https://optimism.example"]);
  });

  it("uses explicit defaults only when no selection record exists", () => {
    const firstRun = new Networks({ adapters, defaultNamespace: "eip155", bootstrap: bootstrap() });
    expect(firstRun.getSelection()).toEqual({
      selectedNamespace: "eip155",
      selectedChainRef: "eip155:1",
      selectedChainRefByNamespace: { eip155: "eip155:1", solana: "solana:mainnet" },
    });

    const stored = new Networks({
      adapters,
      defaultNamespace: "eip155",
      bootstrap: bootstrap({
        selectedNamespace: "solana",
        selectedChainRefByNamespace: { eip155: "eip155:10", solana: "solana:mainnet" },
      }),
    });
    expect(stored.getSelection()).toEqual({
      selectedNamespace: "solana",
      selectedChainRef: "solana:mainnet",
      selectedChainRefByNamespace: { eip155: "eip155:10", solana: "solana:mainnet" },
    });
  });

  it("rejects an incomplete stored selection instead of merging defaults", () => {
    expect(
      () =>
        new Networks({
          adapters,
          defaultNamespace: "eip155",
          bootstrap: bootstrap({
            selectedNamespace: "eip155",
            selectedChainRefByNamespace: { eip155: "eip155:10" },
          }),
        }),
    ).toThrow(NetworkSelectionMissingError);
  });
});
