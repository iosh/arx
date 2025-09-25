import type { Caip2ChainId, ChainState, NetworkController, NetworkMessenger, NetworkState } from "./types.js";

const NETWORK_STATE_TOPIC = "network:stateChanged";
const NETWORK_CHAIN_TOPIC = "network:chainChanged";

export type NetworkControllerOptions = {
  messenger: NetworkMessenger;
  initialState: NetworkState;
};

const cloneChain = (chain: ChainState): ChainState => ({
  caip2: chain.caip2,
  chainId: chain.chainId,
  rpcUrl: chain.rpcUrl,
  name: chain.name,
  nativeCurrency: {
    name: chain.nativeCurrency.name,
    symbol: chain.nativeCurrency.symbol,
    decimals: chain.nativeCurrency.decimals,
  },
});

const cloneState = (state: NetworkState): NetworkState => ({
  active: cloneChain(state.active),
  knownChains: state.knownChains.map(cloneChain),
});

const isSameNativeCurrency = (prev?: ChainState["nativeCurrency"], next?: ChainState["nativeCurrency"]) => {
  if (!prev || !next) return false;

  return prev.name === next.name && prev.symbol === next.symbol && prev.decimals === next.decimals;
};

const isSameChain = (prev?: ChainState, next?: ChainState) => {
  if (!prev || !next) {
    return false;
  }
  return (
    prev.caip2 === next.caip2 &&
    prev.chainId === next.chainId &&
    prev.rpcUrl === next.rpcUrl &&
    prev.name === next.name &&
    isSameNativeCurrency(prev.nativeCurrency, next.nativeCurrency)
  );
};

const isSameNetworkState = (prev?: NetworkState, next?: NetworkState) => {
  if (!prev || !next) return false;

  if (!isSameChain(prev.active, next.active)) return false;

  if (prev.knownChains.length !== next.knownChains.length) return false;

  return prev.knownChains.every((prevChain, index) => isSameChain(prevChain, next.knownChains[index]));
};

export class InMemoryNetworkController implements NetworkController {
  #messenger: NetworkMessenger;

  #state: NetworkState;

  constructor({ messenger, initialState }: NetworkControllerOptions) {
    this.#messenger = messenger;
    this.#state = cloneState(initialState);
    this.#publishState();
  }

  getState(): NetworkState {
    return cloneState(this.#state);
  }

  async switchChain(target: Caip2ChainId): Promise<ChainState> {
    const next = this.#state.knownChains.find((chain) => chain.caip2 === target);
    if (!next) {
      throw new Error(`Unknown chain: ${target}`);
    }

    if (isSameChain(this.#state.active, next)) {
      return cloneChain(this.#state.active);
    }

    this.#state = {
      active: cloneChain(next),
      knownChains: this.#state.knownChains.map(cloneChain),
    };

    this.#publishState();
    return cloneChain(this.#state.active);
  }

  async addChain(chain: ChainState, options?: { activate?: boolean; replaceExisting?: boolean }): Promise<ChainState> {
    const incoming = cloneChain(chain);
    const knownChains = this.#state.knownChains.map(cloneChain);
    const existingIndex = knownChains.findIndex((item) => item.caip2 === incoming.caip2);

    let nextKnownChains = knownChains;
    let resolvedChain = incoming;

    if (existingIndex >= 0) {
      if (options?.replaceExisting) {
        nextKnownChains[existingIndex] = incoming;
        resolvedChain = incoming;
      } else {
        resolvedChain = nextKnownChains[existingIndex]!;
      }
    } else {
      nextKnownChains = [...knownChains, incoming];
    }

    const shouldActivate = options?.activate ?? this.#state.active.caip2 === resolvedChain.caip2;

    const nextActive = shouldActivate ? cloneChain(resolvedChain) : cloneChain(this.#state.active);

    const nextState: NetworkState = {
      active: nextActive,
      knownChains: nextKnownChains,
    };

    if (!isSameNetworkState(this.#state, nextState)) {
      this.#state = cloneState(nextState);
      this.#publishState();
    }

    return shouldActivate ? cloneChain(nextActive) : cloneChain(resolvedChain);
  }

  onChainChanged(handler: (state: ChainState) => void) {
    return this.#messenger.subscribe(NETWORK_CHAIN_TOPIC, handler);
  }

  #publishState() {
    const snapshot = cloneState(this.#state);

    this.#messenger.publish(NETWORK_STATE_TOPIC, snapshot, {
      compare: isSameNetworkState,
    });

    this.#messenger.publish(NETWORK_CHAIN_TOPIC, cloneChain(snapshot.active), {
      compare: isSameChain,
    });
  }
}
