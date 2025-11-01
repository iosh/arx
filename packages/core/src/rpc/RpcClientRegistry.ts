import type { JsonRpcParams } from "@metamask/utils";
import type { NetworkController, RpcEndpointInfo, RpcOutcomeReport } from "../controllers/network/types.js";
import { getRpcErrors } from "../errors/index.js";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type AbortFactory = () => AbortController;

export type RpcTransportRequest<T = unknown> = {
  method: string;
  params?: JsonRpcParams;
  timeoutMs?: number;
  id?: number | string;
};

export type RpcTransport = <T>(request: RpcTransportRequest<T>) => Promise<T>;
type AnyCapabilities = Record<string, unknown>;
type RpcClientCapabilities = Record<string, unknown>;
export type RpcClient<TCapabilities extends RpcClientCapabilities = RpcClientCapabilities> = {
  request<T = unknown>(payload: RpcTransportRequest<T>): Promise<T>;
} & TCapabilities;

export type RpcClientLogEvent =
  | {
      type: "request";
      namespace: string;
      chainRef: string;
      method: string;
      attempt: number;
      endpoint: RpcEndpointInfo;
    }
  | {
      type: "response";
      namespace: string;
      chainRef: string;
      method: string;
      attempt: number;
      endpoint: RpcEndpointInfo;
      durationMs: number;
    }
  | {
      type: "retry";
      namespace: string;
      chainRef: string;
      method: string;
      attempt: number;
      endpoint: RpcEndpointInfo;
      error: unknown;
      delayMs: number;
    }
  | {
      type: "error";
      namespace: string;
      chainRef: string;
      method: string;
      endpoint: RpcEndpointInfo | null;
      attempts: number;
      error: unknown;
    };

export type RpcClientRegistryOptions = {
  network: Pick<
    NetworkController,
    "getActiveEndpoint" | "reportRpcOutcome" | "onRpcEndpointChanged" | "onChainChanged"
  >;
  fetch?: FetchFn;
  abortController?: AbortFactory;
  logger?: (event: RpcClientLogEvent) => void;
  defaultTimeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
};

export type RpcClientFactory<TCapabilities extends RpcClientCapabilities = RpcClientCapabilities> = (params: {
  namespace: string;
  chainRef: string;
  network: RpcClientRegistryOptions["network"];
  transport: RpcTransport;
}) => RpcClient<TCapabilities>;

type TransportConfig = {
  fetchFn: FetchFn;
  abortFactory: AbortFactory;
  logger: (event: RpcClientLogEvent) => void;
  defaultTimeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
};

type OutcomeError = Extract<RpcOutcomeReport, { success: false }>["error"];

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 300;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readMessage = (value: unknown, fallback: string): string => {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return fallback;
};

const readCode = (value: unknown): number | string | undefined => {
  if (value && typeof value === "object" && "code" in value) {
    const raw = (value as { code: unknown }).code;
    if (typeof raw === "number" || typeof raw === "string") {
      return raw;
    }
  }
  return undefined;
};

const readData = (value: unknown): unknown => {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: unknown }).data;
  }
  return undefined;
};

const toOutcomeError = (value: unknown, fallback: string): OutcomeError => ({
  message: readMessage(value, fallback),
  code: readCode(value),
  data: readData(value),
});

const buildInternalError = (
  namespace: string,
  method: string,
  endpoint: RpcEndpointInfo | null,
  message: string,
  detail?: unknown,
) => {
  const rpc = getRpcErrors(namespace);
  const data: Record<string, unknown> = { method };
  if (endpoint) data.endpoint = endpoint.url;
  if (detail !== undefined) data.detail = detail;
  return rpc.internal({ message, data });
};

class RpcTransportFailure extends Error {
  outcome: OutcomeError;
  endpoint: RpcEndpointInfo | null;

  constructor(message: string, outcome: OutcomeError, endpoint: RpcEndpointInfo | null) {
    super(message);
    this.name = "RpcTransportFailure";
    this.outcome = outcome;
    this.endpoint = endpoint;
  }
}

const createJsonRpcTransport = (
  namespace: string,
  chainRef: string,
  network: RpcClientRegistryOptions["network"],
  config: TransportConfig,
): RpcTransport => {
  const { fetchFn, abortFactory, defaultTimeoutMs, maxAttempts, retryBackoffMs, logger } = config;

  return async <T>(request: RpcTransportRequest<T>): Promise<T> => {
    const attempts = Math.max(1, maxAttempts);
    let endpoint: RpcEndpointInfo | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        endpoint = network.getActiveEndpoint(chainRef);
      } catch (error) {
        const outcome = toOutcomeError(error, "No active RPC endpoint available");
        network.reportRpcOutcome(chainRef, {
          success: false,
          error: outcome,
        });

        if (attempt === attempts) {
          logger({
            type: "error",
            namespace,
            chainRef,
            method: request.method,
            endpoint: null,
            attempts: attempt,
            error,
          });
          throw buildInternalError(namespace, request.method, null, outcome.message, error);
        }

        const delay = retryBackoffMs * 2 ** (attempt - 1);
        await wait(delay);
        continue;
      }
      const controller = abortFactory();
      const timeout = request.timeoutMs ?? defaultTimeoutMs;
      const startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;

      logger({
        type: "request",
        namespace,
        chainRef,
        method: request.method,
        attempt,
        endpoint,
      });

      try {
        timer = setTimeout(() => controller.abort(), timeout);

        const payload: Record<string, unknown> = {
          jsonrpc: "2.0",
          id: request.id ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`,
          method: request.method,
        };
        if (request.params !== undefined) {
          payload.params = request.params;
        }

        const response = await fetchFn(endpoint.url, {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timer);
        timer = undefined;

        logger({
          type: "response",
          namespace,
          chainRef,
          method: request.method,
          attempt,
          endpoint,
          durationMs: Date.now() - startedAt,
        });

        if (!response.ok) {
          const outcome = {
            message: `HTTP ${response.status}`,
            code: response.status,
            data: { statusText: response.statusText },
          };
          network.reportRpcOutcome(chainRef, { success: false, endpointIndex: endpoint.index, error: outcome });
          throw new RpcTransportFailure(outcome.message, outcome, endpoint);
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch (parseError) {
          const outcome = {
            message: "Failed to parse RPC response",
            code: "PARSE_ERROR",
            data: { error: parseError },
          };
          network.reportRpcOutcome(chainRef, { success: false, endpointIndex: endpoint.index, error: outcome });
          throw new RpcTransportFailure(outcome.message, outcome, endpoint);
        }

        if (json && typeof json === "object") {
          const envelope = json as { result?: T; error?: unknown };
          if (envelope.error !== undefined) {
            const outcome = toOutcomeError(envelope.error, "RPC node returned an error");
            network.reportRpcOutcome(chainRef, { success: false, endpointIndex: endpoint.index, error: outcome });
            throw new RpcTransportFailure(outcome.message, outcome, endpoint);
          }
          if (envelope.result !== undefined) {
            network.reportRpcOutcome(chainRef, { success: true, endpointIndex: endpoint.index });
            return envelope.result;
          }
        }

        const outcome = {
          message: "RPC response missing result",
          code: "INVALID_RESPONSE",
          data: json,
        };
        network.reportRpcOutcome(chainRef, { success: false, endpointIndex: endpoint.index, error: outcome });
        throw new RpcTransportFailure(outcome.message, outcome, endpoint);
      } catch (error) {
        if (timer) {
          clearTimeout(timer);
        }

        const outcome =
          error instanceof RpcTransportFailure
            ? error.outcome
            : toOutcomeError(
                error,
                error instanceof DOMException && error.name === "AbortError"
                  ? "RPC request timed out"
                  : "RPC request failed",
              );

        network.reportRpcOutcome(chainRef, {
          success: false,
          endpointIndex: endpoint?.index,
          error: outcome,
        });

        if (attempt === attempts) {
          logger({
            type: "error",
            namespace,
            chainRef,
            method: request.method,
            endpoint,
            attempts,
            error,
          });
          throw buildInternalError(namespace, request.method, endpoint, outcome.message, error);
        }

        const delay = retryBackoffMs * 2 ** (attempt - 1);
        logger({
          type: "retry",
          namespace,
          chainRef,
          method: request.method,
          attempt,
          endpoint,
          error,
          delayMs: delay,
        });
        await wait(delay);
      }
    }

    throw buildInternalError(namespace, request.method, null, "RPC request aborted before execution");
  };
};

export class RpcClientRegistry {
  #network: RpcClientRegistryOptions["network"];
  #config: TransportConfig;
  #clients = new Map<string, Map<string, RpcClient<RpcClientCapabilities>>>();
  #factories = new Map<string, RpcClientFactory<RpcClientCapabilities>>();
  #subscriptions: Array<() => void> = [];

  constructor(options: RpcClientRegistryOptions) {
    const fetchFn = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      throw new Error("RpcClientRegistry requires a fetch implementation");
    }

    this.#network = options.network;
    this.#config = {
      fetchFn,
      abortFactory: options.abortController ?? (() => new AbortController()),
      logger:
        options.logger ??
        (() => {
          /* noop */
        }),
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? DEFAULT_ATTEMPTS,
      retryBackoffMs: options.retryBackoffMs ?? DEFAULT_BACKOFF_MS,
    };

    this.#subscriptions.push(
      this.#network.onRpcEndpointChanged(({ chainRef }) => {
        this.#purge(chainRef);
      }),
    );
    this.#subscriptions.push(
      this.#network.onChainChanged((metadata) => {
        this.#purge(metadata.chainRef);
      }),
    );
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
    if (!namespace) throw new Error("RpcClientRegistry.getClient requires a namespace");
    if (!chainRef) throw new Error("RpcClientRegistry.getClient requires a chainRef");

    const [chainNamespace] = chainRef.split(":");
    if (chainNamespace && chainNamespace !== namespace) {
      throw new Error(`Namespace mismatch: chainRef "${chainRef}" does not match namespace "${namespace}"`);
    }
    let perNamespace = this.#clients.get(namespace);
    if (!perNamespace) {
      perNamespace = new Map<string, RpcClient<RpcClientCapabilities>>();
      this.#clients.set(namespace, perNamespace);
    }

    if (!perNamespace.has(chainRef)) {
      const factory = this.#factories.get(namespace) as RpcClientFactory<TCapabilities> | undefined;
      if (!factory) {
        throw new Error(`No RPC client factory registered for namespace "${namespace}"`);
      }
      const transport = createJsonRpcTransport(namespace, chainRef, this.#network, this.#config);
      const client = factory({
        namespace,
        chainRef,
        network: this.#network,
        transport,
      }) as RpcClient<RpcClientCapabilities>;
      perNamespace.set(chainRef, client);
    }

    return perNamespace.get(chainRef)! as RpcClient<TCapabilities>;
  }

  unregisterClient(namespace: string, chainRef: string): void {
    const perNamespace = this.#clients.get(namespace);
    if (!perNamespace) return;
    perNamespace.delete(chainRef);
    if (perNamespace.size === 0) {
      this.#clients.delete(namespace);
    }
  }

  destroy(): void {
    for (const unsubscribe of this.#subscriptions) {
      try {
        unsubscribe();
      } catch {
        // ignore teardown failure
      }
    }
    this.#subscriptions = [];
    this.#clients.clear();
    this.#factories.clear();
  }
  /**
   * Clear cached clients for a chainRef. Endpoint changes require factories to rebuild
   * transport state (e.g., auth headers, retry counters), so we drop the cached instance.
   */
  #purge(chainRef: string) {
    for (const perNamespace of this.#clients.values()) {
      perNamespace.delete(chainRef);
    }
  }
}
