import type { Caip2ChainId } from "../../chains/ids.js";
import type { ChainMetadata, NativeCurrency } from "../../chains/metadata.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type NetworkRpcStatus = {
  endpointIndex: number;
  lastError?: string | undefined;
};

export type NetworkState = {
  activeChain: Caip2ChainId;
  knownChains: ChainMetadata[];
  rpcStatus: Record<Caip2ChainId, NetworkRpcStatus>;
};

export type NetworkRpcStatusUpdate = {
  chainRef: Caip2ChainId;
  status: NetworkRpcStatus;
};

export type NetworkMessengerTopic = {
  "network:stateChanged": NetworkState;
  "network:chainChanged": ChainMetadata;
  "network:rpcStatusChanged": NetworkRpcStatusUpdate;
};

export type NetworkMessenger = ControllerMessenger<NetworkMessengerTopic>;

export interface NetworkController {
  getState(): NetworkState;
  getActiveChain(): ChainMetadata;
  getChain(chainRef: Caip2ChainId): ChainMetadata | null;
  onStateChanged(handler: (state: NetworkState) => void): () => void;
  onChainChanged(handler: (chain: ChainMetadata) => void): () => void;
  onRpcStatusChanged(handler: (update: NetworkRpcStatusUpdate) => void): () => void;
  switchChain(target: Caip2ChainId): Promise<ChainMetadata>;
  addChain(chain: ChainMetadata, options?: { activate?: boolean }): Promise<ChainMetadata>;
  updateRpcStatus(chainRef: Caip2ChainId, status: NetworkRpcStatus): void;
  replaceState(state: NetworkState): void;
}
