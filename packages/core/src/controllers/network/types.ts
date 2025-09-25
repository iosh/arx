import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type NativeCurrency = {
  name: string;
  symbol: string;
  decimals: number;
};

export type Caip2ChainId = `${string}:${string}`;

export type ChainState = {
  caip2: Caip2ChainId;
  chainId: number;
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
  getState: () => NetworkState;
  switchChain: (target: Caip2ChainId) => Promise<ChainState>;
  onChainChanged: (handler: (state: ChainState) => void) => void;
};
