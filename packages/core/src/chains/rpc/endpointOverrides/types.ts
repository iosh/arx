import type { Unsubscribe } from "../../../messenger/index.js";
import type { ChainRef } from "../../../networks/chainRef.js";
import type { RpcEndpoint } from "../../../networks/types.js";
import type { ChainRpcEndpointOverrideRecord } from "../../../storage/records.js";

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
