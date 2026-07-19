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
  blockExplorers?: readonly BlockExplorer[] | undefined;
  iconUrl?: string | undefined;
}>;

export type RpcEndpoint = string;

export type NonEmptyRpcEndpoints = readonly [RpcEndpoint, ...RpcEndpoint[]];

export type BuiltinNetworkSeed = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

export const defineBuiltinNetworkSeeds = <const TSeeds extends readonly BuiltinNetworkSeed[]>(seeds: TSeeds): TSeeds =>
  seeds;
