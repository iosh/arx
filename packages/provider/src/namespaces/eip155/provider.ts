import type { JsonRpcVersion2 } from "@arx/core";
import { EventEmitter } from "eventemitter3";
import { evmProviderErrors, evmRpcErrors } from "../../errors.js";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "../../types/eip1193.js";
import type { Transport, TransportMeta, TransportState } from "../../types/transport.js";
import { isTransportMeta } from "../../utils/transportMeta.js";
import {
  DEFAULT_APPROVAL_METHODS,
  DEFAULT_APPROVAL_TIMEOUT_MS,
  DEFAULT_ETH_ACCOUNTS_WAIT_MS,
  DEFAULT_NORMAL_TIMEOUT_MS,
  DEFAULT_READONLY_METHODS,
  DEFAULT_READONLY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  PROVIDER_INFO,
  READONLY_EARLY,
} from "./constants.js";
import { Eip155ProviderState, type ProviderPatch, type ProviderSnapshot, type ProviderStateSnapshot } from "./state.js";

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
const isLegacyCallback = (value: unknown): value is LegacyCallback => typeof value === "function";

export type Eip155ProviderTimeouts = {
  readyTimeoutMs?: number;
  ethAccountsWaitMs?: number;
  requestTimeouts?: {
    readonlyTimeoutMs?: number;
    normalTimeoutMs?: number;
    approvalTimeoutMs?: number;
    readonlyMethods?: ReadonlyArray<string>;
    approvalMethods?: ReadonlyArray<string>;
  };
};

export type Eip155ProviderOptions = {
  transport: Transport;
  timeouts?: Eip155ProviderTimeouts;
};

type ApplyOptions = { emit?: boolean };

export class Eip155Provider extends EventEmitter implements EIP1193Provider {
  #transport: Transport;
  #state = new Eip155ProviderState();
  #initialized = false;

  #initializedResolve?: (() => void) | undefined;
  #initializedReject?: ((reason?: unknown) => void) | undefined;
  #initializedPromise!: Promise<void>;

  #readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS;
  #ethAccountsWaitMs = DEFAULT_ETH_ACCOUNTS_WAIT_MS;
  #normalTimeoutMs = DEFAULT_NORMAL_TIMEOUT_MS;
  #readonlyTimeoutMs = DEFAULT_READONLY_TIMEOUT_MS;
  #approvalTimeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS;
  #approvalMethods = DEFAULT_APPROVAL_METHODS;
  #readonlyMethods = DEFAULT_READONLY_METHODS;

  #connectInFlight: Promise<void> | null = null;

  constructor({ transport, timeouts }: Eip155ProviderOptions) {
    super();
    this.#transport = transport;
    this.#configureTimeouts(timeouts);
    this.#createReadyPromise();

    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
    this.#transport.on("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.on("chainChanged", this.#handleTransportChainChanged);
    this.#transport.on("unlockStateChanged", this.#handleTransportUnlockStateChanged);
    this.#transport.on("metaChanged", this.#handleTransportMetaChanged);

    this.#syncWithTransportState();
  }

  static readonly providerInfo = PROVIDER_INFO;

  #configureTimeouts(timeouts: Eip155ProviderTimeouts | undefined) {
    if (!timeouts) return;

    this.#readyTimeoutMs = timeouts.readyTimeoutMs ?? this.#readyTimeoutMs;
    this.#ethAccountsWaitMs = timeouts.ethAccountsWaitMs ?? this.#ethAccountsWaitMs;

    const requestTimeouts = timeouts.requestTimeouts;
    if (!requestTimeouts) return;

    this.#readonlyTimeoutMs = requestTimeouts.readonlyTimeoutMs ?? this.#readonlyTimeoutMs;
    this.#normalTimeoutMs = requestTimeouts.normalTimeoutMs ?? this.#normalTimeoutMs;
    this.#approvalTimeoutMs = requestTimeouts.approvalTimeoutMs ?? this.#approvalTimeoutMs;

    if (requestTimeouts.approvalMethods) {
      this.#approvalMethods = new Set(requestTimeouts.approvalMethods);
    }
    if (requestTimeouts.readonlyMethods) {
      this.#readonlyMethods = new Set(requestTimeouts.readonlyMethods);
    }
  }

  #normalizeAccounts(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  #normalizeMeta(value: unknown): TransportMeta | null {
    if (value === null) return null;
    if (isTransportMeta(value)) return value;
    return null;
  }

  get caip2() {
    return this.#state.caip2;
  }

  get isUnlocked() {
    return this.#state.isUnlocked;
  }

  get chainId() {
    return this.#state.chainId;
  }

  get selectedAddress() {
    return this.#state.selectedAddress;
  }

  isConnected = () => {
    return this.#transport.isConnected();
  };

  getProviderState = (): ProviderStateSnapshot => this.#state.getProviderState();

  request = async (args: RequestArguments) => {
    const { method } = this.#parseRequest(args);
    const providerErrors = evmProviderErrors;

    if (method === "eth_accounts") {
      if (!this.#initialized) {
        await this.#prefetchAccounts();
      }
      return this.#state.accounts;
    }

    if (!this.#initialized && READONLY_EARLY.has(method)) {
      if (method === "eth_chainId") {
        if (this.chainId) return this.chainId;
        await this.#waitReady();
        if (this.chainId) return this.chainId;
        throw providerErrors.disconnected();
      }
    }

    if (!this.#initialized) {
      await this.#waitReady();
    }

    try {
      return await this.#sendRpc(args, method);
    } catch (error) {
      throw this.#toEip1193Error(error);
    }
  };

  enable = async () => {
    const rpcErrors = evmRpcErrors;
    const result = await this.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
      throw rpcErrors.internal({
        message: "eth_requestAccounts did not return an array of accounts",
        data: { result },
      });
    }
    return result;
  };

  // Legacy compatibility surface for older dapps and libraries.
  // - send(method, params): resolves a JSON-RPC response object (id is always undefined)
  // - send(payload): supports a minimal sync subset (eth_accounts/eth_coinbase/net_version)
  // - sendAsync(payload|payload[]): supports single and batch callback style
  send = (methodOrPayload: string | LegacyPayload, paramsOrCallback?: unknown) => {
    if (typeof methodOrPayload === "string") {
      const requestArgs = this.#createRequestArgs(methodOrPayload, paramsOrCallback as RequestArguments["params"]);
      return this.request(requestArgs).then((result) => ({ id: undefined, jsonrpc: "2.0", result }));
    }

    if (isLegacyCallback(paramsOrCallback)) {
      this.sendAsync(methodOrPayload, paramsOrCallback);
      return;
    }

    return this.#legacySendSync(methodOrPayload);
  };

  sendAsync = (payload: LegacyPayload | LegacyPayload[], callback: LegacyCallback) => {
    if (Array.isArray(payload)) {
      Promise.all(payload.map((item) => this.#legacyRpcRequest(item))).then((responses) => callback(null, responses));
      return;
    }

    void this.#legacyRpcRequest(payload).then((response) => {
      callback(response.error ?? null, response);
    });
  };

  #legacyRpcRequest = async (payload: LegacyPayload): Promise<LegacyResponse> => {
    const requestArgs = this.#createRequestArgs(payload.method, payload.params as RequestArguments["params"]);
    const id = payload.id;
    const jsonrpc = payload.jsonrpc ?? "2.0";

    try {
      const result = await this.request(requestArgs);
      return { id, jsonrpc, result };
    } catch (error) {
      const rpcError = this.#toEip1193Error(error);
      return { id, jsonrpc, error: rpcError };
    }
  };

  #legacySendSync = (payload: LegacyPayload): LegacyResponse => {
    const id = payload.id;
    const jsonrpc = payload.jsonrpc ?? "2.0";

    switch (payload.method) {
      case "eth_accounts": {
        const result = this.selectedAddress ? [this.selectedAddress] : [];
        return { id, jsonrpc, result };
      }

      case "eth_coinbase": {
        const result = this.selectedAddress ?? null;
        return { id, jsonrpc, result };
      }

      case "net_version": {
        const result = this.getProviderState().networkVersion;
        return { id, jsonrpc, result };
      }

      default: {
        throw new Error(`Unsupported sync method "${payload.method}"`);
      }
    }
  };

  destroy() {
    this.#transport.removeListener("connect", this.#handleTransportConnect);
    this.#transport.removeListener("disconnect", this.#handleTransportDisconnect);
    this.#transport.removeListener("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.removeListener("chainChanged", this.#handleTransportChainChanged);
    this.#transport.removeListener("unlockStateChanged", this.#handleTransportUnlockStateChanged);
    this.#transport.removeListener("metaChanged", this.#handleTransportMetaChanged);
    this.removeAllListeners();
  }

  #createRequestArgs(method: string, params?: RequestArguments["params"]): RequestArguments {
    return params === undefined ? { method } : { method, params };
  }

  #toEip1193Error(error: unknown): EIP1193ProviderRpcError {
    if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
      return error as EIP1193ProviderRpcError;
    }
    return evmRpcErrors.internal({
      message: error instanceof Error ? error.message : String(error),
      data: { originalError: error },
    });
  }

  #getMethodTimeoutMs(method: string): number {
    if (this.#approvalMethods.has(method)) return this.#approvalTimeoutMs;
    if (this.#readonlyMethods.has(method)) return this.#readonlyTimeoutMs;
    if (method.startsWith("eth_get") || method === "eth_call") return this.#readonlyTimeoutMs;
    return this.#normalTimeoutMs;
  }

  #parseRequest(args: RequestArguments): { method: string; params: RequestArguments["params"] | undefined } {
    const rpcErrors = evmRpcErrors;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw rpcErrors.invalidRequest({
        message: "Invalid request arguments",
        data: { args },
      });
    }

    const { method, params } = args;
    if (typeof method !== "string" || method.length === 0) {
      throw rpcErrors.invalidRequest({
        message: "Invalid request method",
        data: { args },
      });
    }
    if (params !== undefined && !Array.isArray(params) && (typeof params !== "object" || params === null)) {
      throw rpcErrors.invalidRequest({
        message: "Invalid request params",
        data: { args },
      });
    }

    return { method, params };
  }

  async #waitReady() {
    try {
      await this.#waitForReady();
    } catch (error) {
      throw this.#toEip1193Error(error);
    }
  }

  async #sendRpc(args: RequestArguments, method: string) {
    const timeoutMs = this.#getMethodTimeoutMs(method);
    const result = await this.#transport.request(args, { timeoutMs });
    if (method === "eth_requestAccounts" && Array.isArray(result)) {
      const next = this.#normalizeAccounts(result);
      this.#applyPatch({ type: "accounts", accounts: next }, { emit: true });
    }
    return result;
  }

  #applySnapshot(snapshot: ProviderSnapshot, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;

    const wasInitialized = this.#initialized;
    const { accountsChanged } = this.#state.applySnapshot(snapshot);

    if (snapshot.connected) {
      this.#resolveReady();
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

  #applyPatch(patch: ProviderPatch, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;
    const prevNetworkVersion = this.#state.getProviderState().networkVersion;
    const events = this.#state.applyPatch(patch);
    const nextNetworkVersion = this.#state.getProviderState().networkVersion;
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
    if (events.unlockChanged) {
      this.emit("unlockStateChanged", events.unlockChanged);
    }
  }

  #createReadyPromise() {
    this.#initializedPromise = new Promise((resolve, reject) => {
      this.#initializedResolve = resolve;
      this.#initializedReject = reject;
    });
  }

  #syncWithTransportState() {
    const state: TransportState = this.#transport.getConnectionState();

    this.#applySnapshot(
      {
        connected: state.connected,
        chainId: state.chainId,
        caip2: state.caip2,
        accounts: this.#normalizeAccounts(state.accounts),
        isUnlocked: typeof state.isUnlocked === "boolean" ? state.isUnlocked : null,
        meta: this.#normalizeMeta(state.meta),
      },
      { emit: false },
    );
  }

  #resolveReady() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#initializedResolve?.();
      this.#initializedReject = undefined;

      this.emit("_initialized");
    }
  }

  #restartReady(error?: unknown) {
    this.#initialized = false;
    const reason = error ?? evmProviderErrors.disconnected();
    this.#initializedReject?.(reason);
    this.#createReadyPromise();
  }

  #handleTransportMetaChanged = (payload: unknown) => {
    if (payload === undefined) return;
    const meta = this.#normalizeMeta(payload);
    if (meta === null && payload !== null) return;
    this.#applyPatch({ type: "meta", meta }, { emit: true });
  };

  #handleTransportConnect = (payload: unknown) => {
    const data = (payload ?? {}) as Partial<{
      chainId: string;
      caip2: string | null;
      accounts: unknown;
      isUnlocked: boolean;
      meta: unknown;
    }>;

    this.#applySnapshot(
      {
        connected: true,
        chainId: typeof data.chainId === "string" ? data.chainId : null,
        caip2: typeof data.caip2 === "string" ? data.caip2 : null,
        accounts: this.#normalizeAccounts(data.accounts),
        isUnlocked: typeof data.isUnlocked === "boolean" ? data.isUnlocked : null,
        meta: data.meta === undefined ? null : this.#normalizeMeta(data.meta),
      },
      { emit: true },
    );
  };

  #handleTransportChainChanged = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;

    const { chainId, caip2, isUnlocked, meta } = payload as Partial<{
      chainId: unknown;
      caip2: unknown;
      isUnlocked: unknown;
      meta: unknown;
    }>;

    if (typeof chainId !== "string") return;

    const patch: ProviderPatch = { type: "chain", chainId };

    if (typeof caip2 === "string" || caip2 === null) {
      patch.caip2 = caip2;
    }
    if (typeof isUnlocked === "boolean") {
      patch.isUnlocked = isUnlocked;
    }
    if (meta === null || isTransportMeta(meta)) {
      patch.meta = meta as TransportMeta | null;
    }

    this.#applyPatch(patch, { emit: true });
  };

  #handleTransportAccountsChanged = (accounts: unknown) => {
    const next = this.#normalizeAccounts(accounts);
    this.#applyPatch({ type: "accounts", accounts: next }, { emit: true });
  };

  #handleTransportUnlockStateChanged = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { isUnlocked } = payload as { isUnlocked?: unknown };
    if (typeof isUnlocked !== "boolean") return;
    this.#applyPatch({ type: "unlock", isUnlocked }, { emit: true });
  };

  #handleTransportDisconnect = (error?: unknown) => {
    const disconnectError = error ?? evmProviderErrors.disconnected();

    this.#restartReady(disconnectError);
    this.#state.reset();

    this.emit("disconnect", disconnectError);
  };

  #startConnect() {
    if (this.#connectInFlight) return;

    this.#connectInFlight = this.#transport
      .connect()
      .catch(() => {
        // Best-effort: readiness is enforced by ready timeout.
      })
      .finally(() => {
        this.#connectInFlight = null;
      });
  }

  async #waitForReady() {
    if (this.#initialized) return;

    this.#startConnect();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#initializedPromise,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              evmProviderErrors.custom({
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

  async #prefetchAccounts() {
    if (this.#initialized) return;
    if (this.#state.accounts.length) return;

    this.#startConnect();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#initializedPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.#ethAccountsWaitMs);
        }),
      ]);
    } catch {
      // eth_accounts must never throw when not ready
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
