import { vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../../../../chainJsonRpc/ChainJsonRpc.js";

type RequestHandler = (request: ChainJsonRpcRequest) => unknown | Promise<unknown>;

export const createChainJsonRpcMock = (handler: RequestHandler = () => null) => {
  const request = vi.fn(handler);
  const client: ChainJsonRpc = {
    async request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult> {
      return (await request(input)) as TResult;
    },
  };
  return { client, request };
};
