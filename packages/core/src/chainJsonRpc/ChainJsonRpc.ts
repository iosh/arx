import type { ChainRef } from "../networks/chainRef.js";
import type { NetworkRpcEndpointsReader } from "../networks/types.js";
import { ChainJsonRpcUnavailableError } from "./errors.js";
import { ChainJsonRpcHttpTransportError, type JsonRpcHttpTransport } from "./JsonRpcHttpTransport.js";
import type { JsonRpcRequest } from "./types.js";

export type ChainJsonRpcRequest = JsonRpcRequest & Readonly<{ chainRef: ChainRef }>;

/** Reads an installed chain, trying its configured endpoints on transport failure. */
export type ChainJsonRpc = Readonly<{
  request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult>;
}>;

export type ChainJsonRpcOptions = Readonly<{
  endpoints: NetworkRpcEndpointsReader;
  transport: JsonRpcHttpTransport;
}>;

export const createChainJsonRpc = ({ endpoints, transport }: ChainJsonRpcOptions): ChainJsonRpc => ({
  async request<TResult = unknown>({ chainRef, ...request }: ChainJsonRpcRequest): Promise<TResult> {
    let lastTransportError: ChainJsonRpcHttpTransportError | undefined;

    for (const endpoint of endpoints.getRpcEndpoints(chainRef)) {
      try {
        return await transport.request<TResult>({ endpoint, ...request });
      } catch (error) {
        if (!(error instanceof ChainJsonRpcHttpTransportError)) throw error;
        lastTransportError = error;
      }
    }

    throw new ChainJsonRpcUnavailableError(lastTransportError);
  },
});
