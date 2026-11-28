import * as RpcRequest from "ox/RpcRequest";
import { ArxBaseError, toJsonSafe } from "../errors.js";
import type { RpcEndpoint } from "../networks/types.js";
import { ChainJsonRpcResponseError } from "./errors.js";
import type { JsonRpcRequest } from "./types.js";

export type JsonRpcHttpRequest = JsonRpcRequest & Readonly<{ endpoint: RpcEndpoint }>;

export type JsonRpcHttpTransport = Readonly<{
  request<TResult = unknown>(request: JsonRpcHttpRequest): Promise<TResult>;
}>;

export class ChainJsonRpcHttpTransportError extends ArxBaseError {
  static readonly code = "chain_json_rpc.http_transport";

  constructor(message: string, cause?: unknown) {
    super(message, {
      code: ChainJsonRpcHttpTransportError.code,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const createJsonRpcHttpTransport = (options: { fetch?: typeof globalThis.fetch } = {}): JsonRpcHttpTransport => {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const requests = RpcRequest.createStore({ id: 1 });

  return {
    async request<TResult = unknown>({ endpoint, ...request }: JsonRpcHttpRequest): Promise<TResult> {
      const payload = requests.prepare(request);
      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((cause) => {
        throw new ChainJsonRpcHttpTransportError("RPC request failed.", cause);
      });

      const invalidResponse = (message: string, cause?: unknown) =>
        new ChainJsonRpcHttpTransportError(
          response.ok ? message : `RPC endpoint returned HTTP ${response.status}.`,
          cause,
        );
      const reply: unknown = await response.json().catch((cause) => {
        throw invalidResponse("RPC endpoint returned invalid JSON.", cause);
      });
      if (!isRecord(reply)) {
        throw invalidResponse("Invalid JSON-RPC response.");
      }
      if (reply.jsonrpc !== "2.0" || reply.id !== payload.id) {
        throw invalidResponse("JSON-RPC response does not match the request.");
      }
      const { error } = reply;
      if (isRecord(error) && typeof error.code === "number" && typeof error.message === "string") {
        throw new ChainJsonRpcResponseError({
          rpcCode: error.code,
          message: error.message,
          data: toJsonSafe(error.data),
        });
      }
      if (!response.ok || !("result" in reply)) {
        throw invalidResponse("JSON-RPC response is missing a result.");
      }
      return reply.result as TResult;
    },
  };
};
