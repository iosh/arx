import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type ChainRpcDefaultEndpointsChangedPayload = {
  chainRef: ChainRef;
  previous: ChainRpcDefaultEndpointsRecord | null;
  next: ChainRpcDefaultEndpointsRecord | null;
};

export type ChainRpcDefaultEndpointsChangedHandler = (payload: ChainRpcDefaultEndpointsChangedPayload) => void;

export type ChainRpcDefaultEndpointsSeed = {
  chainRef: ChainRef;
  rpcEndpoints: readonly RpcEndpoint[];
  source: ChainRpcDefaultEndpointsRecord["source"];
};

export type ChainRpcDefaultEndpointsService = {
  subscribeChanged(handler: ChainRpcDefaultEndpointsChangedHandler): Unsubscribe;
  get(chainRef: ChainRef): Promise<ChainRpcDefaultEndpointsRecord | null>;
  getAll(): Promise<ChainRpcDefaultEndpointsRecord[]>;
  readDefaultEndpoints(chainRef: ChainRef): RpcEndpoint[] | null;
  setDefaultEndpoints(
    chainRef: ChainRef,
    endpoints: readonly RpcEndpoint[],
    source: ChainRpcDefaultEndpointsRecord["source"],
  ): Promise<ChainRpcDefaultEndpointsRecord>;
  replaceDefaultEndpoints(seeds: readonly ChainRpcDefaultEndpointsSeed[]): Promise<void>;
  clearDefaultEndpoints(chainRef: ChainRef): Promise<void>;
};
