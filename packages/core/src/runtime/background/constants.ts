import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type { NetworkState, RpcEndpointState, RpcStrategyConfig } from "../../controllers/network/types.js";
import type { PermissionsState } from "../../controllers/permission/types.js";

export const UNKNOWN_ORIGIN = "unknown://";

const DEFAULT_CHAIN_SEED = DEFAULT_CHAIN_METADATA[0];
if (!DEFAULT_CHAIN_SEED) {
  throw new Error("DEFAULT_CHAIN_METADATA must include at least one chain definition");
}

export const DEFAULT_CHAIN: ChainMetadata = DEFAULT_CHAIN_SEED;
export const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };

const cloneHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers));
};

export const buildDefaultEndpointState = (metadata: ChainMetadata, strategy?: RpcStrategyConfig): RpcEndpointState => {
  const endpoints = metadata.rpcEndpoints.map((endpoint, index) => ({
    index,
    url: endpoint.url,
    type: endpoint.type,
    weight: endpoint.weight,
    headers: cloneHeaders(endpoint.headers),
  }));

  if (endpoints.length === 0) {
    throw new Error(`Chain ${metadata.chainRef} must declare at least one RPC endpoint`);
  }

  const health = endpoints.map((_endpoint, index) => ({
    index,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
  }));

  return {
    activeIndex: 0,
    endpoints,
    health,
    strategy: strategy
      ? { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined }
      : { ...DEFAULT_STRATEGY },
    lastUpdatedAt: 0,
  };
};

export const DEFAULT_NETWORK_STATE: NetworkState = {
  activeChain: DEFAULT_CHAIN.chainRef,
  knownChains: [DEFAULT_CHAIN],
  rpc: {
    [DEFAULT_CHAIN.chainRef]: buildDefaultEndpointState(DEFAULT_CHAIN),
  },
};

export const DEFAULT_ACCOUNTS_STATE: MultiNamespaceAccountsState = {
  namespaces: {
    eip155: { all: [], primary: null },
  },
  active: {
    namespace: "eip155",
    chainRef: DEFAULT_CHAIN.chainRef,
    address: null,
  },
};

export const DEFAULT_PERMISSIONS_STATE: PermissionsState = {
  origins: {},
};
