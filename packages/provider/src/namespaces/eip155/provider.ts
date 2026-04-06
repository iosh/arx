import type { JsonRpcVersion2 } from "@arx/core";
import { EventEmitter } from "eventemitter3";
import { isTransportFailure, type TransportFailure } from "../../transport/index.js";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "../../types/eip1193.js";
import type { Transport } from "../../types/transport.js";
import {
  DEFAULT_APPROVAL_METHOD_NAMES,
  DEFAULT_APPROVAL_TIMEOUT_MS,
  DEFAULT_ETH_ACCOUNTS_WAIT_MS,
  DEFAULT_NORMAL_TIMEOUT_MS,
  DEFAULT_READONLY_METHOD_NAMES,
  DEFAULT_READONLY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  REQUEST_VALIDATION_MESSAGES,
} from "./constants.js";
import { providerErrors, rpcErrors } from "./errors.js";
import { Eip155ProviderState, type ProviderPatch, type ProviderSnapshot } from "./state.js";

type LegacyResponse = {
  id: unknown;
  jsonrpc: JsonRpcVersion2;
  result?: unknown;
  error?: EIP1193ProviderRpcError;
};

type LegacyCallback = (
  error: EIP1193ProviderRpcError | null,
  response: LegacyResponse | LegacyResponse[] | undefined,
) => void;

type LegacyPayload = {
  method: string;
  params?: unknown;
  id?: unknown;
  jsonrpc?: JsonRpcVersion2;
};

type ApplyOptions = { emit?: boolean };
type LockedMethod = (...args: never[]) => unknown;

/**
 * Request timeout overrides for different RPC buckets.
 */
export type Eip155RequestTimeouts = {
  readonlyTimeoutMs?: number;
  normalTimeoutMs?: number;
  approvalTimeoutMs?: number;
  readonlyMethodNames?: ReadonlyArray<string>;
  approvalMethodNames?: ReadonlyArray<string>;
};

type ResolvedRequestTimeouts = {
  readonlyTimeoutMs: number;
  normalTimeoutMs: number;
  approvalTimeoutMs: number;
  readonlyMethodNames: ReadonlySet<string>;
  approvalMethodNames: ReadonlySet<string>;
};

const createRequestTimeouts = (overrides?: Eip155RequestTimeouts): ResolvedRequestTimeouts => ({
  readonlyTimeoutMs: overrides?.readonlyTimeoutMs ?? DEFAULT_READONLY_TIMEOUT_MS,
  normalTimeoutMs: overrides?.normalTimeoutMs ?? DEFAULT_NORMAL_TIMEOUT_MS,
  approvalTimeoutMs: overrides?.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
  readonlyMethodNames: new Set(overrides?.readonlyMethodNames ?? DEFAULT_READONLY_METHOD_NAMES),
  approvalMethodNames: new Set(overrides?.approvalMethodNames ?? DEFAULT_APPROVAL_METHOD_NAMES),
});

const resolveRequestTimeoutMs = (method: string, timeouts: ResolvedRequestTimeouts) => {
  if (timeouts.approvalMethodNames.has(method)) {
    return timeouts.approvalTimeoutMs;
  }

  if (timeouts.readonlyMethodNames.has(method) || method.startsWith("eth_get") || method === "eth_call") {
    return timeouts.readonlyTimeoutMs;
  }

  return timeouts.normalTimeoutMs;
};

/**
 * Tuning knobs for bootstrap timing and request timeout behavior.
 */
export type Eip155ProviderTimeouts = {
  readyTimeoutMs?: number;
  ethAccountsWaitMs?: number;
  requestTimeouts?: Eip155RequestTimeouts;
};

/**
 * Construction options for the page-facing EIP-155 provider.
 */
export type Eip155ProviderOptions = {
  transport: Transport<ProviderSnapshot, ProviderPatch>;
  timeouts?: Eip155ProviderTimeouts;
};

/**
 * Page-facing EIP-155 provider with standard EIP-1193 behavior and legacy compatibility helpers.
 */
export class Eip155Provider extends EventEmitter implements EIP1193Provider {
  declare readonly chainId: string | null;
  declare readonly selectedAddress: string | null;
  declare readonly networkVersion: string | null;
  declare readonly isMetaMask: true;
  declare readonly _metamask: Readonly<{
    isUnlocked: () => Promise<boolean>;
  }>;

  #transport: Transport<ProviderSnapshot, ProviderPatch>;
  #state = new Eip155ProviderState();
  #initialized = false;
  #requestTimeouts = createRequestTimeouts();

  #initializedResolve?: (() => void) | undefined;
  #initializedReject?: ((reason?: unknown) => void) | undefined;
  #initializedPromise!: Promise<void>;

  #readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS;
  #ethAccountsWaitMs = DEFAULT_ETH_ACCOUNTS_WAIT_MS;
  #bootstrapInFlight: Promise<void> | null = null;

  constructor({ transport, timeouts }: Eip155ProviderOptions) {
    super();
    this.#transport = transport;
    this.#configureTimeouts(timeouts);
    this.#createReadyPromise();
    this.#defineInjected();

    this.#transport.on("patch", this.#handleTransportPatch);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
  }

  /**
   * Returns whether the transport is currently connected.
   */
  isConnected(): boolean {
    return this.#transport.isConnected();
  }

  /**
   * Handles EIP-1193 requests and applies bootstrap semantics before forwarding RPC calls.
   */
  async request(args: RequestArguments): Promise<unknown> {
    const { method } = this.#parseRequest(args);

    if (method === "eth_accounts") {
      // `eth_accounts` must stay non-throwing while the provider is still warming up.
      if (!this.#initialized) {
        await this.#prefetchAccounts();
      }
      return this.#state.accounts;
    }

    if (method === "eth_chainId") {
      if (this.chainId) return this.chainId;
      await this.#waitReady();
      if (this.chainId) return this.chainId;
      throw providerErrors.disconnected();
    }

    if (!this.#initialized) {
      await this.#waitReady();
    }

    try {
      return await this.#sendRpc(args, method);
    } catch (error) {
      throw this.#toEip1193Error(error);
    }
  }

  /**
   * Requests account access via the legacy `enable()` method.
   */
  async enable(): Promise<string[]> {
    const result = await this.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
      throw rpcErrors.internal({
        message: "eth_requestAccounts did not return an array of accounts",
        data: { result },
      });
    }
    return result;
  }

  /**
   * Legacy helper for wallet permissions.
   */
  wallet_getPermissions(): Promise<unknown> {
    return this.request({ method: "wallet_getPermissions" });
  }

  /**
   * Legacy helper for requesting wallet permissions.
   */
  wallet_requestPermissions(params?: RequestArguments["params"]): Promise<unknown> {
    return params === undefined
      ? this.request({ method: "wallet_requestPermissions" })
      : this.request({ method: "wallet_requestPermissions", params });
  }

  send(method: string, params?: RequestArguments["params"]): Promise<LegacyResponse>;
  send(payload: LegacyPayload): LegacyResponse;
  send(payload: LegacyPayload, callback: LegacyCallback): void;
  /**
   * Legacy RPC entrypoint used by older dapps and web3 libraries.
   */
  send(
    methodOrPayload: string | LegacyPayload,
    paramsOrCallback?: RequestArguments["params"] | LegacyCallback,
  ): Promise<LegacyResponse> | LegacyResponse | void {
    if (typeof methodOrPayload === "string") {
      const requestArgs = this.#createRequestArgs(methodOrPayload, paramsOrCallback as RequestArguments["params"]);
      return this.request(requestArgs).then((result) => ({ id: undefined, jsonrpc: "2.0", result }));
    }

    if (typeof paramsOrCallback === "function") {
      this.sendAsync(methodOrPayload, paramsOrCallback);
      return;
    }

    return this.#sendSync(methodOrPayload);
  }

  /**
   * Legacy callback-based RPC helper.
   */
  sendAsync(payload: LegacyPayload | LegacyPayload[], callback: LegacyCallback): void {
    if (Array.isArray(payload)) {
      Promise.all(payload.map((item) => this.#legacyRpcRequest(item))).then((responses) => callback(null, responses));
      return;
    }

    void this.#legacyRpcRequest(payload).then((response) => {
      callback(response.error ?? null, response);
    });
  }

  /**
   * Resolves the small synchronous subset supported by legacy `send(payload)`.
   */
  #sendSync(payload: LegacyPayload): LegacyResponse {
    const id = payload.id;
    const jsonrpc = payload.jsonrpc ?? "2.0";

    switch (payload.method) {
      case "eth_accounts":
        return { id, jsonrpc, result: this.selectedAddress ? [this.selectedAddress] : [] };

      case "eth_coinbase":
        return { id, jsonrpc, result: this.selectedAddress };

      case "net_version":
        return { id, jsonrpc, result: this.networkVersion };

      default:
        throw new Error(`Unsupported sync method "${payload.method}"`);
    }
  }

  /**
   * Adapts legacy callback-style requests to the modern `request()` path.
   */
  async #legacyRpcRequest(payload: LegacyPayload): Promise<LegacyResponse> {
    const requestArgs = this.#createRequestArgs(payload.method, payload.params as RequestArguments["params"]);
    const id = payload.id;
    const jsonrpc = payload.jsonrpc ?? "2.0";

    try {
      const result = await this.request(requestArgs);
      return { id, jsonrpc, result };
    } catch (error) {
      return { id, jsonrpc, error: this.#toEip1193Error(error) };
    }
  }

  /**
   * Locks the page-facing methods and legacy shims on the provider instance.
   */
  #defineInjected() {
    const metamaskShim = Object.freeze({
      isUnlocked: () => Promise.resolve(this.#state.isUnlocked ?? false),
    });

    // Standard provider methods and event emitter hooks.
    this.#defineBoundMethod("request", this.request);
    this.#defineBoundMethod("isConnected", this.isConnected);
    this.#defineBoundMethod("on", EventEmitter.prototype.on as LockedMethod);
    this.#defineBoundMethod("once", EventEmitter.prototype.once as LockedMethod);
    this.#defineBoundMethod("removeListener", EventEmitter.prototype.removeListener as LockedMethod);
    this.#defineBoundMethod("removeAllListeners", EventEmitter.prototype.removeAllListeners as LockedMethod);

    // Legacy RPC entrypoints and permission helpers kept for older dapps.
    this.#defineBoundMethod("send", this.send as LockedMethod);
    this.#defineBoundMethod("sendAsync", this.sendAsync as LockedMethod);
    this.#defineBoundMethod("enable", this.enable as LockedMethod);
    this.#defineBoundMethod("wallet_getPermissions", this.wallet_getPermissions as LockedMethod);
    this.#defineBoundMethod("wallet_requestPermissions", this.wallet_requestPermissions as LockedMethod);

    // Readonly compatibility fields commonly expected on injected providers.
    this.#defineReadonlyGetter("selectedAddress", () => this.#state.selectedAddress, true);
    this.#defineReadonlyGetter("chainId", () => this.#state.chainId, true);
    this.#defineReadonlyGetter("networkVersion", () => this.#state.networkVersion, true);
    this.#defineReadonlyValue("isMetaMask", true, true);
    this.#defineReadonlyValue("_metamask", metamaskShim, false);
  }

  /**
   * Defines a non-configurable method on the provider instance.
   */
  #defineBoundMethod<TArgs extends unknown[], TResult>(property: string, method: (...args: TArgs) => TResult) {
    this.#defineReadonlyValue(property, method.bind(this), false);
  }

  /**
   * Defines a non-configurable readonly value on the provider instance.
   */
  #defineReadonlyValue(property: string, value: unknown, enumerable: boolean) {
    Object.defineProperty(this, property, {
      configurable: false,
      enumerable,
      value,
      writable: false,
    });
  }

  /**
   * Defines a non-configurable getter on the provider instance.
   */
  #defineReadonlyGetter(property: string, get: () => unknown, enumerable: boolean) {
    Object.defineProperty(this, property, {
      configurable: false,
      enumerable,
      get,
    });
  }

  /**
   * Applies constructor overrides for bootstrap and request timing.
   */
  #configureTimeouts(timeouts: Eip155ProviderTimeouts | undefined) {
    if (!timeouts) return;

    this.#readyTimeoutMs = timeouts.readyTimeoutMs ?? this.#readyTimeoutMs;
    this.#ethAccountsWaitMs = timeouts.ethAccountsWaitMs ?? this.#ethAccountsWaitMs;
    this.#requestTimeouts = createRequestTimeouts(timeouts.requestTimeouts);
  }

  #createRequestArgs(method: string, params?: RequestArguments["params"]): RequestArguments {
    return params === undefined ? { method } : { method, params };
  }

  #toEip1193Error(error: unknown): EIP1193ProviderRpcError {
    if (isTransportFailure(error)) {
      return this.#mapTransportFailure(error);
    }
    if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
      return error as EIP1193ProviderRpcError;
    }
    return rpcErrors.internal({
      message: error instanceof Error ? error.message : String(error),
      data: { originalError: error },
    });
  }

  #parseRequest(args: RequestArguments): { method: string; params: RequestArguments["params"] | undefined } {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw rpcErrors.invalidRequest({
        message: REQUEST_VALIDATION_MESSAGES.invalidArgs,
        data: args,
      });
    }

    const { method, params } = args;
    if (typeof method !== "string" || method.length === 0) {
      throw rpcErrors.invalidRequest({
        message: REQUEST_VALIDATION_MESSAGES.invalidMethod,
        data: args,
      });
    }
    if (params !== undefined && !Array.isArray(params) && (typeof params !== "object" || params === null)) {
      throw rpcErrors.invalidRequest({
        message: REQUEST_VALIDATION_MESSAGES.invalidParams,
        data: args,
      });
    }

    return { method, params };
  }

  #mapTransportFailure(error: TransportFailure): EIP1193ProviderRpcError {
    switch (error.reason) {
      case "disconnected":
        return providerErrors.disconnected();

      case "handshake_timeout":
        return providerErrors.custom({
          code: 4900,
          message: error.message,
        });

      case "protocol_version_mismatch":
        return providerErrors.custom({
          code: 4900,
          message: error.message,
          ...(error.data === undefined ? {} : { data: error.data }),
        });

      case "request_timeout":
        return rpcErrors.internal({ message: error.message });

      default:
        return rpcErrors.internal({ message: error.message });
    }
  }

  async #waitReady() {
    try {
      await this.#waitForReady();
    } catch (error) {
      throw this.#toEip1193Error(error);
    }
  }

  /**
   * Forwards an RPC request with the timeout bucket that matches the method.
   */
  async #sendRpc(args: RequestArguments, method: string) {
    return this.#transport.request(args, { timeoutMs: resolveRequestTimeoutMs(method, this.#requestTimeouts) });
  }

  /**
   * Applies the first full snapshot from bootstrap and emits first-load events.
   */
  #applySnapshot(snapshot: ProviderSnapshot, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;
    const wasInitialized = this.#initialized;
    const { accountsChanged } = this.#state.applySnapshot(snapshot);

    if (snapshot.connected) {
      this.#markInitialized();
    }

    if (!emit) return;

    const didInitialize = !wasInitialized && this.#initialized;
    if (didInitialize && this.chainId) {
      this.emit("connect", { chainId: this.chainId });
    }

    if (accountsChanged) {
      this.emit("accountsChanged", this.#state.accounts);
    }
  }

  /**
   * Applies an incremental transport patch after the provider is ready.
   */
  #applyPatch(patch: ProviderPatch, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;
    const prevNetworkVersion = this.networkVersion;
    const prevUnlocked = this.#state.isUnlocked ?? false;
    const events = this.#state.applyPatch(patch);
    const nextNetworkVersion = this.networkVersion;
    const nextUnlocked = this.#state.isUnlocked ?? false;
    if (!emit) return;

    if (events.chainChanged) {
      this.emit("chainChanged", events.chainChanged);
    }
    if (prevNetworkVersion !== nextNetworkVersion) {
      this.emit("networkChanged", nextNetworkVersion);
    }
    if (events.accountsChanged) {
      this.emit("accountsChanged", events.accountsChanged);
    }
    if (prevUnlocked !== nextUnlocked && events.unlockChanged) {
      this.emit("unlockStateChanged", events.unlockChanged);
    }
  }

  #createReadyPromise() {
    this.#initializedPromise = new Promise((resolve, reject) => {
      this.#initializedResolve = resolve;
      this.#initializedReject = reject;
    });
    void this.#initializedPromise.catch(() => {});
  }

  #markInitialized() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#initializedResolve?.();
      this.#initializedReject = undefined;
      this.emit("_initialized");
    }
  }

  /**
   * Clears session-local state after disconnect or a failed bootstrap attempt.
   */
  #resetSession(error?: unknown) {
    this.#state.reset();
    this.#initialized = false;
    const reason = error ?? providerErrors.disconnected();
    this.#initializedReject?.(reason);
    this.#createReadyPromise();
  }

  #handleTransportPatch = (patch: ProviderPatch) => {
    if (!this.#initialized) {
      return;
    }

    this.#applyPatch(patch, { emit: true });
  };

  #handleTransportDisconnect = (error?: unknown) => {
    const eip1193Error = this.#toEip1193Error(error ?? providerErrors.disconnected());
    this.#resetSession(eip1193Error);
    this.emit("disconnect", eip1193Error);
  };

  /**
   * Starts bootstrap once and shares the same in-flight promise with later callers.
   */
  #startBootstrap() {
    if (this.#initialized || this.#bootstrapInFlight) return;

    this.#bootstrapInFlight = this.#transport
      .bootstrap()
      .then((snapshot) => {
        this.#applySnapshot(snapshot, { emit: true });
      })
      .catch((error) => {
        this.#resetSession(this.#toEip1193Error(error));
      })
      .finally(() => {
        this.#bootstrapInFlight = null;
      });
  }

  /**
   * Waits for the first usable snapshot before forwarding stateful requests.
   */
  async #waitForReady() {
    if (this.#initialized) return;

    this.#startBootstrap();
    const readyPromise = this.#initializedPromise;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        readyPromise,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              providerErrors.custom({
                code: 4900,
                message: "Provider is initializing. Try again later.",
              }),
            );
          }, this.#readyTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Gives `eth_accounts` a short chance to warm its cache without throwing.
   */
  async #prefetchAccounts() {
    if (this.#initialized) return;
    if (this.#state.accounts.length) return;

    this.#startBootstrap();
    const readyPromise = this.#initializedPromise;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        readyPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.#ethAccountsWaitMs);
        }),
      ]);
    } catch {
      // `eth_accounts` must not fail just because bootstrap is still in flight.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const createEip155Provider = (options: Eip155ProviderOptions) => new Eip155Provider(options);
