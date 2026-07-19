import type { JsonRpcParams } from "@metamask/utils";
import type { RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../networks/chainRef.js";
import { parseChainRef } from "../networks/chainRef.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "./errors.js";
import { createJsonRpcHttpTransport, type JsonRpcHttpTransport, JsonRpcProtocolError } from "./JsonRpcHttpTransport.js";

export type ChainJsonRpcRequest = {
  chainRef: ChainRef;
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
  id?: number | string;
  replay?: "safe" | "never";
};

export type ChainJsonRpcClient = {
  request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult>;
};

export type ChainJsonRpcOptions = {
  endpoints: Readonly<{
    getRpcEndpoints(chainRef: ChainRef): readonly [RpcEndpoint, ...RpcEndpoint[]];
  }>;
  transport?: JsonRpcHttpTransport;
  fetch?: typeof globalThis.fetch;
  abortController?: () => AbortController;
  defaultTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SAFE_REQUEST_ROUNDS = 2;
const RPC_ID_MAX = 0xffff_ffff;

const createIdAllocator = () => {
  let next = Math.floor(Math.random() * (RPC_ID_MAX + 1));
  return () => {
    next = next === RPC_ID_MAX ? 0 : next + 1;
    return next;
  };
};

export class ChainJsonRpc implements ChainJsonRpcClient {
  readonly #endpoints: ChainJsonRpcOptions["endpoints"];
  readonly #transport: JsonRpcHttpTransport;
  readonly #defaultTimeoutMs: number;
  readonly #allocateId = createIdAllocator();

  constructor(options: ChainJsonRpcOptions) {
    this.#endpoints = options.endpoints;
    this.#transport =
      options.transport ??
      createJsonRpcHttpTransport({
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.abortController ? { abortController: options.abortController } : {}),
      });
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult> {
    parseChainRef(input.chainRef);
    const chainRef = input.chainRef;
    const endpoints = this.#endpoints.getRpcEndpoints(chainRef);
    const canReplay = input.replay !== "never";
    const attemptEndpoints = canReplay ? endpoints : endpoints.slice(0, 1);
    const rounds = canReplay ? DEFAULT_SAFE_REQUEST_ROUNDS : 1;
    const requestId = input.id ?? this.#allocateId();
    let lastError: unknown;
    let attemptCount = 0;

    for (let round = 0; round < rounds; round += 1) {
      for (const endpoint of attemptEndpoints) {
        attemptCount += 1;
        try {
          return (await this.#transport.request(endpoint, {
            method: input.method,
            id: requestId,
            timeoutMs: input.timeoutMs ?? this.#defaultTimeoutMs,
            ...(input.params !== undefined ? { params: input.params } : {}),
          })) as TResult;
        } catch (error) {
          if (error instanceof JsonRpcProtocolError) {
            throw new ChainJsonRpcResponseError({
              chainRef,
              method: input.method,
              rpcCode: error.code,
              message: error.message,
              data: error.data,
            });
          }
          if (!canReplay) {
            throw new ChainJsonRpcOutcomeUnknownError({
              chainRef,
              method: input.method,
              cause: error,
            });
          }
          lastError = error;
        }
      }
    }

    throw new ChainJsonRpcUnavailableError({
      chainRef,
      method: input.method,
      attempts: attemptCount,
      cause: lastError,
    });
  }
}
