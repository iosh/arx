import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import type { ChainRpcEndpointOverrideRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type ChainRpcEndpointOverridesChangedPayload = {
  chainRef: ChainRef;
  previous: ChainRpcEndpointOverrideRecord | null;
  next: ChainRpcEndpointOverrideRecord | null;
};

export type ChainRpcEndpointOverridesChangedHandler = (payload: ChainRpcEndpointOverridesChangedPayload) => void;

export type ChainRpcEndpointOverridesService = {
  subscribeChanged(handler: ChainRpcEndpointOverridesChangedHandler): Unsubscribe;
  get(chainRef: ChainRef): Promise<ChainRpcEndpointOverrideRecord | null>;
  getAll(): Promise<ChainRpcEndpointOverrideRecord[]>;
  readEndpointOverride(chainRef: ChainRef): RpcEndpoint[] | null;
  setEndpointOverride(chainRef: ChainRef, endpoints: RpcEndpoint[]): Promise<ChainRpcEndpointOverrideRecord>;
  clearEndpointOverride(chainRef: ChainRef): Promise<void>;
};
