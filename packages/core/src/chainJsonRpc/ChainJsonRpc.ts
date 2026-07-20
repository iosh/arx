import type { JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../networks/chainRef.js";
import type { NetworkRpcEndpointsReader } from "../networks/types.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "./errors.js";
import {
  ChainJsonRpcHttpProtocolError,
  ChainJsonRpcHttpTransportError,
  createJsonRpcHttpTransport,
  type JsonRpcHttpTransport,
} from "./JsonRpcHttpTransport.js";

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

export const createChainJsonRpc = (options: ChainJsonRpcOptions): ChainJsonRpc => {
  const transport =
    options.transport ??
    createJsonRpcHttpTransport({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.abortController ? { abortController: options.abortController } : {}),
    });

  return {
    async request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult> {
      const endpoints = options.endpoints.getRpcEndpoints(input.chainRef);
      let lastTransportError: ChainJsonRpcHttpTransportError | undefined;

      for (const endpoint of endpoints) {
        try {
          return await transport.request<TResult>({
            endpoint,
            method: input.method,
            ...(input.params !== undefined ? { params: input.params } : {}),
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
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
        attempts: endpoints.length,
        cause: lastTransportError,
      });
    },
  };
};
