import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../chains/metadata.js";
import { cloneNetworkStateInput } from "../../controllers/network/config.js";
import type { NetworkStateInput, RpcStrategyConfig } from "../../controllers/network/types.js";
import { buildDefaultRoutingState } from "./constants.js";

export type RuntimeNetworkPreferencesDefaults = {
  selectedNamespace: string;
  selectedChainRef: ChainRef;
  activeChainByNamespace: Record<string, ChainRef>;
};

export type RuntimeNetworkPlan = {
  admittedChains: ChainMetadata[];
  bootstrapState: NetworkStateInput;
  deferredState: NetworkStateInput | null;
  preferencesDefaults: RuntimeNetworkPreferencesDefaults;
};

const createBootstrapStateForChain = (
  chain: ChainMetadata,
  defaultStrategy?: RpcStrategyConfig,
): NetworkStateInput => ({
  availableChainRefs: [chain.chainRef],
  rpc: {
    [chain.chainRef]: buildDefaultRoutingState(chain, defaultStrategy),
  },
});

const createActiveChainDefaults = (
  admittedChains: readonly ChainMetadata[],
  selectedChainRef: ChainRef,
): Record<string, ChainRef> => {
  const next: Record<string, ChainRef> = {};

  for (const chain of admittedChains) {
    if (!(chain.namespace in next)) {
      next[chain.namespace] = chain.chainRef;
    }
  }

  next[getChainRefNamespace(selectedChainRef)] = selectedChainRef;
  return next;
};

export const buildRuntimeNetworkPlan = (params: {
  admittedChains: readonly ChainMetadata[];
  requestedInitialState?: NetworkStateInput;
  defaultStrategy?: RpcStrategyConfig;
}): RuntimeNetworkPlan => {
  const admittedChains = params.admittedChains.map((chain) => cloneChainMetadata(chain));
  const primaryChain = admittedChains[0];
  if (!primaryChain) {
    throw new Error("createBackgroundRuntime requires at least one admitted bootstrap chain definition");
  }

  const chainByRef = new Map<ChainRef, ChainMetadata>(admittedChains.map((chain) => [chain.chainRef, chain]));
  const fallbackState = createBootstrapStateForChain(primaryChain, params.defaultStrategy);
  const requestedState = params.requestedInitialState
    ? cloneNetworkStateInput(params.requestedInitialState)
    : cloneNetworkStateInput(fallbackState);

  const requestedSelectedChainRef = requestedState.availableChainRefs.find((chainRef) => chainByRef.has(chainRef));
  const selectedChainRef = requestedSelectedChainRef ?? primaryChain.chainRef;
  const selectedChain = chainByRef.get(selectedChainRef);
  if (!selectedChain) {
    throw new Error(`Missing admitted chain metadata for selected chain "${selectedChainRef}"`);
  }

  const canResolveRequestedState = requestedState.availableChainRefs.every((chainRef) => chainByRef.has(chainRef));
  const bootstrapState = canResolveRequestedState
    ? cloneNetworkStateInput(requestedState)
    : createBootstrapStateForChain(selectedChain, params.defaultStrategy);

  return {
    admittedChains,
    bootstrapState,
    deferredState: canResolveRequestedState ? null : requestedState,
    preferencesDefaults: {
      selectedNamespace: selectedChain.namespace,
      selectedChainRef,
      activeChainByNamespace: createActiveChainDefaults(admittedChains, selectedChainRef),
    },
  };
};
