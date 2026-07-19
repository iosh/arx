import type { JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../networks/chainRef.js";
import { parseChainRef } from "../networks/chainRef.js";
import type { NonEmptyRpcEndpoints } from "../networks/types.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "./errors.js";
import {
  ChainJsonRpcHttpProtocolError,
  createJsonRpcHttpTransport,
  type JsonRpcHttpTransport,
} from "./JsonRpcHttpTransport.js";

export type ChainJsonRpcRequest = {
  chainRef: ChainRef;
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
  replay?: "safe" | "never";
};

export type ChainJsonRpcClient = {
  request<TResult = unknown>(input: ChainJsonRpcRequest): Promise<TResult>;
};

export type ChainJsonRpcOptions = {
  endpoints: Readonly<{
    getRpcEndpoints(chainRef: ChainRef): NonEmptyRpcEndpoints;
  }>;
  transport?: JsonRpcHttpTransport;
  fetch?: typeof globalThis.fetch;
  abortController?: () => AbortController;
  defaultTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SAFE_REQUEST_ROUNDS = 2;

export class ChainJsonRpc implements ChainJsonRpcClient {
  readonly #endpoints: ChainJsonRpcOptions["endpoints"];
  readonly #transport: JsonRpcHttpTransport;
  readonly #defaultTimeoutMs: number;

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
    let lastError: unknown;
    let attemptCount = 0;

    for (let round = 0; round < rounds; round += 1) {
      for (const endpoint of attemptEndpoints) {
        attemptCount += 1;
        try {
          return await this.#transport.request<TResult>({
            endpoint,
            method: input.method,
            timeoutMs: input.timeoutMs ?? this.#defaultTimeoutMs,
            ...(input.params !== undefined ? { params: input.params } : {}),
          });
        } catch (error) {
          if (error instanceof ChainJsonRpcHttpProtocolError) {
            throw new ChainJsonRpcResponseError({
              chainRef,
              method: input.method,
              rpcCode: error.rpcCode,
              message: error.message,
              data: error.rpcData,
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
