import type { ChainRef } from "../networks/chainRef.js";
import type { NetworkRpcEndpointsReader } from "../networks/types.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "./errors.js";
import {
  ChainJsonRpcHttpProtocolError,
  ChainJsonRpcHttpTransportError,
  createJsonRpcHttpTransport,
  type JsonRpcHttpTransport,
} from "./JsonRpcHttpTransport.js";
import type { JsonRpcParams } from "./types.js";

export type ChainJsonRpcRequest = Readonly<{
  chainRef: ChainRef;
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
  replay: "allowed" | "forbidden";
}>;

export type ChainJsonRpc = Readonly<{
  request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult>;
}>;

export type ChainJsonRpcOptions = Readonly<{
  endpoints: NetworkRpcEndpointsReader;
  transport?: JsonRpcHttpTransport;
  fetch?: typeof globalThis.fetch;
  abortController?: () => AbortController;
}>;

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export const createChainJsonRpc = (options: ChainJsonRpcOptions): ChainJsonRpc => {
  const transport =
    options.transport ??
    createJsonRpcHttpTransport({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.abortController ? { abortController: options.abortController } : {}),
    });
  return {
    async request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult> {
      const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      const endpoints = options.endpoints.getRpcEndpoints(input.chainRef);
      let lastTransportError: ChainJsonRpcHttpTransportError | undefined;
      let attempts = 0;

      for (const endpoint of endpoints) {
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) break;
        attempts += 1;

        try {
          return await transport.request<TResult>({
            endpoint,
            method: input.method,
            ...(input.params !== undefined ? { params: input.params } : {}),
            timeoutMs,
          });
        } catch (error) {
          if (error instanceof ChainJsonRpcHttpProtocolError) {
            throw new ChainJsonRpcResponseError({
              chainRef: input.chainRef,
              method: input.method,
              rpcCode: error.rpcCode,
              message: error.message,
              data: error.rpcData,
            });
          }
          if (!(error instanceof ChainJsonRpcHttpTransportError)) throw error;
          if (input.replay === "forbidden") {
            throw new ChainJsonRpcOutcomeUnknownError({
              chainRef: input.chainRef,
              method: input.method,
              cause: error,
            });
          }
          lastTransportError = error;
        }
      }

      throw new ChainJsonRpcUnavailableError({
        chainRef: input.chainRef,
        method: input.method,
        attempts,
        cause: lastTransportError,
      });
    },
  };
};
