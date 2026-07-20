import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "./chainRef.js";
import type { BuiltinNetworkSeed, RpcEndpoint } from "./types.js";

export type NetworksNamespaceAdapter = Readonly<{
  namespace: Namespace;
  builtinNetworks: readonly [BuiltinNetworkSeed, ...BuiltinNetworkSeed[]];
  defaultChainRef: ChainRef;
  queryChainRef(endpoint: RpcEndpoint): Promise<ChainRef>;
}>;

export type NetworksNamespaceAdapters = readonly [NetworksNamespaceAdapter, ...NetworksNamespaceAdapter[]];
