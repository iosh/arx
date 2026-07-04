import type { JsonRpcParams } from "@metamask/utils";
import { getChainRefNamespace, normalizeChainRef } from "../chains/caip.js";
import type { RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainRpcReader } from "../chains/rpc/types.js";
import { RpcInternalError } from "./errors.js";
import { isJsonRpcErrorLike, JsonRpcResponseError } from "./jsonRpcError.js";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type AbortFactory = () => AbortController;

export type RpcTransportRetry = {
  transportFailure: boolean;
};

export type RpcTransportRequest<_T = unknown> = {
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
  id?: number | string;
  retry?: RpcTransportRetry;
};

export type RpcTransport = <T>(request: RpcTransportRequest<T>) => Promise<T>;

type RpcClientCapabilities = Record<string, unknown>;

export type RpcClient<TCapabilities extends RpcClientCapabilities = RpcClientCapabilities> = {
  request<T = unknown>(payload: RpcTransportRequest<T>): Promise<T>;
} & TCapabilities;

export type ChainRpcClientPoolOptions = {
  chainRpc: Pick<ChainRpcReader, "getEndpoints" | "onEndpointsChanged">;
  fetch?: FetchFn;
  abortController?: AbortFactory;
  defaultTimeoutMs?: number;
  retryBackoffMs?: number;
};

export type RpcClientFactory<TCapabilities extends RpcClientCapabilities = RpcClientCapabilities> = (params: {
  namespace: string;
  chainRef: string;
  chainRpc: ChainRpcClientPoolOptions["chainRpc"];
  transport: RpcTransport;
}) => RpcClient<TCapabilities>;

type TransportConfig = {
  fetchFn: FetchFn;
  abortFactory: AbortFactory;
  defaultTimeoutMs: number;
  retryBackoffMs: number;
};

type TransportErrorInfo = {
  message: string;
  code?: number | string | undefined;
  data?: unknown | undefined;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF_MS = 300;
const RPC_ID_MAX = 0xffff_ffff;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createRpcIdAllocator = () => {
  let nextRpcId = Math.floor(Math.random() * (RPC_ID_MAX + 1));
  return (): number => {
    nextRpcId = nextRpcId === RPC_ID_MAX ? 0 : nextRpcId + 1;
    return nextRpcId;
  };
};

const readTransportErrorInfo = (value: unknown, fallbackMessage: string): TransportErrorInfo => {
  if (typeof value === "string") {
    return { message: value };
  }

  if (!value || typeof value !== "object") {
    return { message: fallbackMessage };
  }

  const candidate = value as Record<string, unknown>;
  const rawCode = candidate.code;
  const code = typeof rawCode === "number" || typeof rawCode === "string" ? rawCode : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : fallbackMessage;

  return {
    message,
    ...(code !== undefined ? { code } : {}),
    ...("data" in candidate ? { data: candidate.data } : {}),
  };
};

const buildInternalError = (
  namespace: string,
  method: string,
  endpoint: RpcEndpoint | null,
  message: string,
  cause?: unknown,
) => {
  const details: Record<string, string> = { namespace, method };
  if (endpoint) details.endpoint = endpoint.url;
  if (cause !== undefined) details.detail = cause instanceof Error ? cause.message : String(cause);
  return new RpcInternalError({ message, details, cause });
};

class RpcTransportFailure extends Error {
  readonly info: TransportErrorInfo;
  readonly endpoint: RpcEndpoint;

  constructor(info: TransportErrorInfo, endpoint: RpcEndpoint) {
    super(info.message);
    this.name = "RpcTransportFailure";
    this.info = info;
    this.endpoint = endpoint;
  }
}

const buildJsonRpcPayload = (request: RpcTransportRequest, allocateRpcId: () => number): Record<string, unknown> => ({
  jsonrpc: "2.0",
  id: request.id ?? allocateRpcId(),
  method: request.method,
  ...(request.params !== undefined ? { params: request.params } : {}),
});

const parseJsonRpcResponse = async <T>(response: Response, endpoint: RpcEndpoint): Promise<T> => {
  if (!response.ok) {
    throw new RpcTransportFailure(
      {
        message: `HTTP ${response.status}`,
        code: response.status,
        data: { statusText: response.statusText },
      },
      endpoint,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new RpcTransportFailure(
      {
        message: "Failed to parse RPC response",
        code: "PARSE_ERROR",
        data: { error },
      },
      endpoint,
    );
  }

  if (json && typeof json === "object") {
    const envelope = json as { result?: T; error?: unknown };
    if (envelope.error !== undefined) {
      const info = readTransportErrorInfo(envelope.error, "RPC node returned an error");
      throw new JsonRpcResponseError({
        code: typeof info.code === "number" ? info.code : -32603,
        message: info.message,
        ...(info.data !== undefined ? { data: info.data } : {}),
      });
    }
    if (envelope.result !== undefined) {
      return envelope.result;
    }
  }

  throw new RpcTransportFailure(
    {
      message: "RPC response missing result",
      code: "INVALID_RESPONSE",
      data: json,
    },
    endpoint,
  );
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

const sendJsonRpcRequest = async <T>({
  endpoint,
  request,
  config,
  allocateRpcId,
}: {
  endpoint: RpcEndpoint;
  request: RpcTransportRequest<T>;
  config: TransportConfig;
  allocateRpcId: () => number;
}): Promise<T> => {
  const abortHandle = config.abortFactory();
  const timeout = request.timeoutMs ?? config.defaultTimeoutMs;
  const timer = setTimeout(() => abortHandle.abort(), timeout);

  try {
    const response = await config.fetchFn(endpoint.url, {
      method: "POST",
      body: JSON.stringify(buildJsonRpcPayload(request, allocateRpcId)),
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.headers ?? {}),
      },
      signal: abortHandle.signal,
    });

    return await parseJsonRpcResponse<T>(response, endpoint);
  } catch (error) {
    if (isJsonRpcErrorLike(error) || error instanceof RpcTransportFailure) {
      throw error;
    }

    throw new RpcTransportFailure(
      readTransportErrorInfo(error, isAbortError(error) ? "RPC request timed out" : "RPC request failed"),
      endpoint,
    );
  } finally {
    clearTimeout(timer);
  }
};

const selectEndpointAttempts = (
  endpoints: readonly [RpcEndpoint, ...RpcEndpoint[]],
  request: RpcTransportRequest,
): readonly RpcEndpoint[] => {
  return request.retry?.transportFailure ? endpoints : [endpoints[0]];
};

const executeWithEndpointAttempts = async <T>({
  namespace,
  request,
  endpoints,
  config,
  allocateRpcId,
}: {
  namespace: string;
  request: RpcTransportRequest<T>;
  endpoints: readonly RpcEndpoint[];
  config: TransportConfig;
  allocateRpcId: () => number;
}): Promise<T> => {
  let lastEndpoint: RpcEndpoint | null = null;
  let lastError: unknown = null;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    if (!endpoint) continue;
    lastEndpoint = endpoint;

    try {
      return await sendJsonRpcRequest({ endpoint, request, config, allocateRpcId });
    } catch (error) {
      if (isJsonRpcErrorLike(error)) {
        throw error;
      }

      lastError = error;
      if (index === endpoints.length - 1) {
        const info =
          error instanceof RpcTransportFailure ? error.info : readTransportErrorInfo(error, "RPC request failed");
        throw buildInternalError(namespace, request.method, endpoint, info.message, error);
      }

      await wait(config.retryBackoffMs * 2 ** index);
    }
  }

  throw buildInternalError(namespace, request.method, lastEndpoint, "RPC request aborted before execution", lastError);
};

const createJsonRpcTransport = (
  namespace: string,
  chainRef: string,
  chainRpc: ChainRpcClientPoolOptions["chainRpc"],
  config: TransportConfig,
): RpcTransport => {
  const allocateRpcId = createRpcIdAllocator();

  return async <T>(request: RpcTransportRequest<T>): Promise<T> => {
    const endpoints = chainRpc.getEndpoints(chainRef);
    return executeWithEndpointAttempts({
      namespace,
      request,
      endpoints: selectEndpointAttempts(endpoints, request),
      config,
      allocateRpcId,
    });
  };
};

export class ChainRpcClientPool {
  #chainRpc: ChainRpcClientPoolOptions["chainRpc"];
  #config: TransportConfig;
  #clients = new Map<string, Map<string, RpcClient<RpcClientCapabilities>>>();
  #factories = new Map<string, RpcClientFactory<RpcClientCapabilities>>();

  constructor(options: ChainRpcClientPoolOptions) {
    const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      throw new Error("ChainRpcClientPool requires a fetch implementation");
    }

    this.#chainRpc = options.chainRpc;
    this.#config = {
      fetchFn,
      abortFactory: options.abortController ?? (() => new AbortController()),
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      retryBackoffMs: options.retryBackoffMs ?? DEFAULT_BACKOFF_MS,
    };

    this.#chainRpc.onEndpointsChanged(({ chainRef }) => {
      this.#purge(chainRef);
    });
  }

  registerFactory<T extends RpcClientCapabilities>(namespace: string, factory: RpcClientFactory<T>): void {
    this.#factories.set(namespace, factory as RpcClientFactory<RpcClientCapabilities>);
    this.#clients.delete(namespace);
  }

  unregisterFactory(namespace: string): void {
    this.#factories.delete(namespace);
    this.#clients.delete(namespace);
  }

  getClient<TCapabilities extends RpcClientCapabilities = RpcClientCapabilities>(
    namespace: string,
    chainRef: string,
  ): RpcClient<TCapabilities> {
    if (!namespace) throw new Error("ChainRpcClientPool.getClient requires a namespace");
    if (!chainRef) throw new Error("ChainRpcClientPool.getClient requires a chainRef");

    const normalizedChainRef = normalizeChainRef(chainRef as ChainRef);
    const chainNamespace = getChainRefNamespace(normalizedChainRef);
    if (chainNamespace !== namespace) {
      throw new Error(`Namespace mismatch: chainRef "${chainRef}" does not match namespace "${namespace}"`);
    }

    let perNamespace = this.#clients.get(namespace);
    if (!perNamespace) {
      perNamespace = new Map<string, RpcClient<RpcClientCapabilities>>();
      this.#clients.set(namespace, perNamespace);
    }

    const existing = perNamespace.get(normalizedChainRef);
    if (existing) {
      return existing as RpcClient<TCapabilities>;
    }

    const factory = this.#factories.get(namespace) as RpcClientFactory<TCapabilities> | undefined;
    if (!factory) {
      throw new Error(`No RPC client factory registered for namespace "${namespace}"`);
    }
    const transport = createJsonRpcTransport(namespace, normalizedChainRef, this.#chainRpc, this.#config);
    const client = factory({
      namespace,
      chainRef: normalizedChainRef,
      chainRpc: this.#chainRpc,
      transport,
    }) as RpcClient<RpcClientCapabilities>;
    perNamespace.set(normalizedChainRef, client);
    return client as RpcClient<TCapabilities>;
  }

  unregisterClient(namespace: string, chainRef: string): void {
    const perNamespace = this.#clients.get(namespace);
    if (!perNamespace) return;
    perNamespace.delete(chainRef);
    if (perNamespace.size === 0) {
      this.#clients.delete(namespace);
    }
  }

  #purge(chainRef: string) {
    for (const perNamespace of this.#clients.values()) {
      perNamespace.delete(chainRef);
    }
  }
}
