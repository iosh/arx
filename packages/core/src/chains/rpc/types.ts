import type { ChainRef } from "../../networks/chainRef.js";
import type { NonEmptyRpcEndpoints } from "../../networks/types.js";

export type ChainRpcAccess = {
  chainRef: ChainRef;
  endpoints: NonEmptyRpcEndpoints;
};

export type ChainRpcState = {
  accesses: ChainRpcAccess[];
};

export type ChainRpcEndpointsChangedEvent = {
  chainRef: ChainRef;
};

export type ChainRpcReader = {
  getState(): ChainRpcState;
  hasEndpoints(chainRef: ChainRef): boolean;
  listChainRefs(): ChainRef[];
  listAccesses(): ChainRpcAccess[];
  getEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints;
  onStateChanged(handler: (state: ChainRpcState) => void): () => void;
  onEndpointsChanged(handler: (event: ChainRpcEndpointsChangedEvent) => void): () => void;
};

export type ChainRpcAccessUpdater = {
  replaceAccesses(accesses: readonly ChainRpcAccess[]): void;
};
