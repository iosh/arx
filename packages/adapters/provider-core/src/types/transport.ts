import type { EIP1193Provider } from "./eip1193.js";

export interface Transport extends EIP1193Provider {
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}

export interface TransportMessage {
  id: string;
  jsonrpc: string;
  method: string;
  params?: unknown[];
}

export interface TransportResponse {
  id: string;
  jsonrpc: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
