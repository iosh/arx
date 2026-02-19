import { DEFAULT_CHAIN_METADATA } from "../../chains/chains.seed.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type {
  NetworkState,
  NetworkStateInput,
  RpcRoutingState,
  RpcStrategyConfig,
} from "../../controllers/network/types.js";
import type { PermissionsState } from "../../controllers/permission/types.js";

export const UNKNOWN_ORIGIN = "unknown://";

const DEFAULT_CHAIN_SEED = DEFAULT_CHAIN_METADATA[0];
if (!DEFAULT_CHAIN_SEED) {
  throw new Error("DEFAULT_CHAIN_METADATA must include at least one chain definition");
}

export const DEFAULT_CHAIN: ChainMetadata = DEFAULT_CHAIN_SEED;
export const DEFAULT_STRATEGY: RpcStrategyConfig = { id: "round-robin" };

export const buildDefaultRoutingState = (metadata: ChainMetadata, strategy?: RpcStrategyConfig): RpcRoutingState => {
  if (metadata.rpcEndpoints.length === 0) {
    throw new Error(`Chain ${metadata.chainRef} must declare at least one RPC endpoint`);
  }
  return {
    activeIndex: 0,
    strategy: strategy
      ? { id: strategy.id, options: strategy.options ? { ...strategy.options } : undefined }
      : { ...DEFAULT_STRATEGY },
  };
};

export const DEFAULT_NETWORK_STATE_INPUT: NetworkStateInput = {
  activeChain: DEFAULT_CHAIN.chainRef,
  knownChains: [DEFAULT_CHAIN],
  rpc: {
    [DEFAULT_CHAIN.chainRef]: buildDefaultRoutingState(DEFAULT_CHAIN),
  },
};

export const DEFAULT_NETWORK_STATE: NetworkState = {
  revision: 0,
  ...DEFAULT_NETWORK_STATE_INPUT,
};

export const DEFAULT_ACCOUNTS_STATE: MultiNamespaceAccountsState = {
  namespaces: {
    eip155: { accountIds: [], selectedAccountId: null },
  },
};

export const DEFAULT_PERMISSIONS_STATE: PermissionsState = {
  origins: {},
};
