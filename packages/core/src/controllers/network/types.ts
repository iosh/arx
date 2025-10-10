import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type NativeCurrency = {
  name: string;
  symbol: string;
  decimals: number;
};

export type Caip2ChainId = string;

export type ChainState = {
  caip2: Caip2ChainId;
  chainId: string;
  rpcUrl: string;
  name: string;
  nativeCurrency: NativeCurrency;
};

export type NetworkState = {
  active: ChainState;
  knownChains: ChainState[];
};

export type NetworkMessengerTopic = {
  "network:stateChanged": NetworkState;
  "network:chainChanged": ChainState;
};

export type NetworkMessenger = ControllerMessenger<NetworkMessengerTopic>;

export type NetworkController = {
  getState(): NetworkState;
  onStateChanged(handler: (state: NetworkState) => void): () => void;
  switchChain(target: Caip2ChainId): Promise<ChainState>;
  addChain(chain: ChainState, options?: { activate?: boolean; replaceExisting?: boolean }): Promise<ChainState>;
  onChainChanged(handler: (state: ChainState) => void): () => void;
  replaceState(state: NetworkState): void;
};
