import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "./chainRef.js";

export type NativeCurrency = Readonly<{
  name: string;
  symbol: string;
  decimals: number;
}>;

export type BlockExplorer = Readonly<{
  url: string;
  name?: string | undefined;
}>;

export type ChainDefinition = Readonly<{
  chainRef: ChainRef;
  name: string;
  nativeCurrency: NativeCurrency;
  /** Marks testing use; absence does not establish asset value. */
  isTestnet?: boolean | undefined;
  blockExplorers?: readonly BlockExplorer[] | undefined;
  iconUrl?: string | undefined;
}>;

/** HTTP or HTTPS node URL. */
export type RpcEndpoint = string;

export type NonEmptyRpcEndpoints = readonly [RpcEndpoint, ...RpcEndpoint[]];

export type BuiltinNetworkSeed = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

export type CustomNetworkInput = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

export type Network = Readonly<{
  chainRef: ChainRef;
  namespace: Namespace;
  source: "builtin" | "custom";
  name: string;
  nativeCurrency: NativeCurrency;
  isTestnet?: boolean | undefined;
  blockExplorers?: readonly BlockExplorer[] | undefined;
  iconUrl?: string | undefined;
}>;

export type NetworkRpcConfiguration =
  | Readonly<{
      source: "default";
      endpoints: NonEmptyRpcEndpoints;
    }>
  | Readonly<{
      source: "override";
      endpoints: NonEmptyRpcEndpoints;
      defaultEndpoints: NonEmptyRpcEndpoints;
    }>;

export type NetworksReader = Readonly<{
  get(chainRef: ChainRef): Network | null;
  list(): readonly Network[];
  listByNamespace(namespace: Namespace): readonly Network[];
  getRpcConfiguration(chainRef: ChainRef): NetworkRpcConfiguration;
}>;

export type NetworkRpcEndpointsReader = Readonly<{
  getRpcEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints;
}>;

export type NetworksChanged = Readonly<{
  type: "networksChanged";
  chainRefs: readonly ChainRef[];
}>;

export const defineBuiltinNetworkSeeds = <const TSeeds extends readonly BuiltinNetworkSeed[]>(seeds: TSeeds): TSeeds =>
  seeds;
