import type { EIP1193ProviderRpcError, RequestArguments } from "./eip1193.js";

export type JsonRpcVersion = "2.0";
export type JsonRpcId = string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  jsonrpc: JsonRpcVersion;
  method: string;
  params?: readonly unknown[] | object;
}

export interface JsonRpcSuccess<T = unknown> {
  id: JsonRpcId;
  jsonrpc: JsonRpcVersion;
  result: T;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export interface JsonRpcError {
  id: JsonRpcId;
  jsonrpc: JsonRpcVersion;
  error: EIP1193ProviderRpcError;
}

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  request(args: RequestArguments): Promise<unknown>;

  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface EventMessage {
  type: "event";
  eventName: string;
  params: unknown[];
}

export type TransportMessage = JsonRpcRequest | JsonRpcResponse | EventMessage;
