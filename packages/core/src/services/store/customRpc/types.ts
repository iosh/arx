import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import type { CustomRpcRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type CustomRpcChangedPayload = {
  chainRef: ChainRef;
  previous: CustomRpcRecord | null;
  next: CustomRpcRecord | null;
};

export type CustomRpcChangedHandler = (payload: CustomRpcChangedPayload) => void;

export type CustomRpcService = {
  subscribeChanged(handler: CustomRpcChangedHandler): Unsubscribe;
  get(chainRef: ChainRef): Promise<CustomRpcRecord | null>;
  getAll(): Promise<CustomRpcRecord[]>;
  getRpcEndpoints(chainRef: ChainRef): RpcEndpoint[] | null;
  set(chainRef: ChainRef, rpcEndpoints: RpcEndpoint[]): Promise<CustomRpcRecord>;
  clear(chainRef: ChainRef): Promise<void>;
};
