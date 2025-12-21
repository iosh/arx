import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  JsonRpcVersion2,
} from "@arx/core";

import type { EIP1193ProviderRpcError, RequestArguments } from "./eip1193.js";

export type JsonRpcId = JsonRpcRequest<JsonRpcParams>["id"];
export type TransportRequest = JsonRpcRequest<JsonRpcParams>;
export type TransportSuccess = JsonRpcSuccess;
export type TransportError = JsonRpcError;
export type TransportResponse = JsonRpcResponse;

export type TransportMeta = {
  activeChain: string;
  activeNamespace: string;
  supportedChains: string[];
};

export type TransportState = {
  connected: boolean;
  chainId: string | null;
  caip2: string | null;
  accounts: string[];
  isUnlocked: boolean | null;
  meta: TransportMeta | null;
};

export type TransportRequestOptions = {
  timeoutMs?: number;
};

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getConnectionState(): TransportState;
  request(args: RequestArguments, options?: TransportRequestOptions): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}
export interface EventMessage {
  type: "event";
  eventName: string;
  params: unknown[];
}

export type TransportMessage = TransportRequest | TransportResponse | EventMessage;

export type { JsonRpcVersion2, EIP1193ProviderRpcError };
