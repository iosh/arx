import type { ChainState, NetworkController, NetworkMessenger, NetworkState } from "./types.js";

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

const isNativeCurrencyEqual = (prev: ChainState["nativeCurrency"], next: ChainState["nativeCurrency"]) => {
  if (!prev || !next) return false;

  return prev.name === next.name && prev.symbol === next.symbol && prev.decimals === next.decimals;
};

const isChainsEqual = (prev?: ChainState, next?: ChainState) => {
  if (!prev || !next) {
    return false;
  }
  return (
    prev.caip2 === next.caip2 &&
    prev.chainId === next.chainId &&
    prev.rpcUrl === next.rpcUrl &&
    prev.name === next.name &&
    isNativeCurrencyEqual(prev.nativeCurrency, next.nativeCurrency)
  );
};

const isStatesEqual = (prev?: NetworkState, next?: NetworkState) => {
  if (!prev || !next) return false;

  if (!isChainsEqual(prev.active, next.active)) return false;

  if (prev.knownChains.length !== next.knownChains.length) return false;

  return prev.knownChains.every((prevChain, index) => isChainsEqual(prevChain, next.knownChains[index]));
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

  async switchChain(target: string): Promise<ChainState> {
    const next = this.#state.knownChains.find((chain) => chain.caip2 === target);
    if (!next) {
      throw new Error(`Unknown chain: ${target}`);
    }

    if (isChainsEqual(this.#state.active, next)) {
      return cloneChain(this.#state.active);
    }

    this.#state = {
      active: cloneChain(next),
      knownChains: this.#state.knownChains.map(cloneChain),
    };

    return cloneChain(this.#state.active);
  }

  onChainChanged(handler: (state: ChainState) => void) {
    return this.#messenger.subscribe(NETWORK_CHAIN_TOPIC, handler);
  }

  #publishState() {
    const snapshot = cloneState(this.#state);

    this.#messenger.publish(NETWORK_STATE_TOPIC, snapshot, {
      compare: isStatesEqual,
    });

    this.#messenger.publish(NETWORK_CHAIN_TOPIC, cloneChain(snapshot.active), { compare: isChainsEqual });
  }
}
