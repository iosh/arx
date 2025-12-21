import type { JsonRpcParams, JsonRpcRequest, JsonRpcVersion2 } from "@arx/core";
import { getProviderErrors, getRpcErrors } from "@arx/core/errors";
import { EventEmitter } from "eventemitter3";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "../../types/eip1193.js";
import type { Transport, TransportMeta, TransportState } from "../../types/transport.js";
import {
  DEFAULT_APPROVAL_METHODS,
  DEFAULT_APPROVAL_TIMEOUT_MS,
  DEFAULT_ETH_ACCOUNTS_WAIT_MS,
  DEFAULT_NORMAL_TIMEOUT_MS,
  DEFAULT_READONLY_METHODS,
  DEFAULT_READONLY_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  PROVIDER_INFO,
  PROVIDER_STATE_METHODS,
  READONLY_EARLY,
} from "./constants.js";
import { Eip155ProviderState, type ProviderPatch, type ProviderSnapshot, type ProviderStateSnapshot } from "./state.js";

type LegacyResponse = {
  id: string;
  jsonrpc: JsonRpcVersion2;
  result?: unknown;
  error?: EIP1193ProviderRpcError;
};
type LegacyCallback = (error: EIP1193ProviderRpcError | null, response: LegacyResponse | undefined) => void;
type LegacyPayload = Partial<Pick<JsonRpcRequest<JsonRpcParams>, "id" | "jsonrpc">> &
  Pick<JsonRpcRequest<JsonRpcParams>, "method" | "params">;
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

  #resolveProviderErrors = () => getProviderErrors(this.#state.namespace);
  #resolveRpcErrors = () => getRpcErrors(this.#state.namespace);

  constructor({ transport, timeouts }: Eip155ProviderOptions) {
    super();
    this.#transport = transport;
    this.#applyTimeouts(timeouts);
    this.#createInitializationPromise();

    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
    this.#transport.on("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.on("chainChanged", this.#handleTransportChainChanged);
    this.#transport.on("unlockStateChanged", this.#handleUnlockStateChanged);
    this.#transport.on("metaChanged", this.#handleMetaChanged);

    this.#syncWithTransportState();
  }

  static readonly providerInfo = PROVIDER_INFO;

  #applyTimeouts(timeouts: Eip155ProviderTimeouts | undefined) {
    if (!timeouts) return;

    if (typeof timeouts.readyTimeoutMs === "number") this.#readyTimeoutMs = timeouts.readyTimeoutMs;
    if (typeof timeouts.ethAccountsWaitMs === "number") this.#ethAccountsWaitMs = timeouts.ethAccountsWaitMs;

    const requestTimeouts = timeouts.requestTimeouts;
    if (!requestTimeouts) return;

    if (typeof requestTimeouts.readonlyTimeoutMs === "number")
      this.#readonlyTimeoutMs = requestTimeouts.readonlyTimeoutMs;
    if (typeof requestTimeouts.normalTimeoutMs === "number") this.#normalTimeoutMs = requestTimeouts.normalTimeoutMs;
    if (typeof requestTimeouts.approvalTimeoutMs === "number")
      this.#approvalTimeoutMs = requestTimeouts.approvalTimeoutMs;

    if (Array.isArray(requestTimeouts.approvalMethods)) {
      this.#approvalMethods = new Set(requestTimeouts.approvalMethods);
    }
    if (Array.isArray(requestTimeouts.readonlyMethods)) {
      this.#readonlyMethods = new Set(requestTimeouts.readonlyMethods);
    }
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

  #handleMetaChanged = (payload: unknown) => {
    if (payload === undefined) return;
    this.#state.applyPatch({ type: "meta", meta: (payload ?? null) as TransportMeta | null });
  };

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

  #applyPatch(patch: ProviderPatch, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;
    const events = this.#state.applyPatch(patch);
    if (!emit) return;

    if (events.chainChanged) {
      this.emit("chainChanged", events.chainChanged);
    }
    if (events.accountsChanged) {
      this.emit("accountsChanged", events.accountsChanged);
    }
    if (events.unlockChanged) {
      this.emit("unlockStateChanged", events.unlockChanged);
    }
  }

  #createInitializationPromise() {
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
        accounts: state.accounts.filter((item): item is string => typeof item === "string"),
        isUnlocked: typeof state.isUnlocked === "boolean" ? state.isUnlocked : null,
        meta: state.meta,
      },
      { emit: false },
    );
  }

  #markInitialized() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#initializedResolve?.();
      this.#initializedReject = undefined;

      this.emit("_initialized");
    }
  }

  #resetInitialization(error?: unknown) {
    this.#initialized = false;
    const reason = error ?? this.#resolveProviderErrors().disconnected();
    this.#initializedReject?.(reason);
    this.#createInitializationPromise();
  }

  #handleTransportConnect = (payload: unknown) => {
    const data = (payload ?? {}) as Partial<{
      chainId: string;
      caip2: string | null;
      accounts: string[];
      isUnlocked: boolean;
      meta: TransportMeta | null;
    }>;

    this.#applySnapshot(
      {
        connected: true,
        chainId: typeof data.chainId === "string" ? data.chainId : null,
        caip2: typeof data.caip2 === "string" ? data.caip2 : null,
        accounts: Array.isArray(data.accounts)
          ? data.accounts.filter((item): item is string => typeof item === "string")
          : [],
        isUnlocked: typeof data.isUnlocked === "boolean" ? data.isUnlocked : null,
        meta: data.meta ?? null,
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
    if (meta === null || (meta && typeof meta === "object")) {
      patch.meta = meta as TransportMeta | null;
    }

    this.#applyPatch(patch, { emit: true });
  };

  #handleTransportAccountsChanged = (accounts: unknown) => {
    if (!Array.isArray(accounts)) return;
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#applyPatch({ type: "accounts", accounts: next }, { emit: true });
  };

  #handleUnlockStateChanged = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { isUnlocked } = payload as { isUnlocked?: unknown };
    if (typeof isUnlocked !== "boolean") return;
    this.#applyPatch({ type: "unlock", isUnlocked }, { emit: true });
  };

  #handleTransportDisconnect = (error?: unknown) => {
    const disconnectError = error ?? this.#resolveProviderErrors().disconnected();

    this.#resetInitialization(disconnectError);
    this.#state.reset();

    this.emit("disconnect", disconnectError);
  };

  #kickoffConnect() {
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

    this.#kickoffConnect();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#initializedPromise,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              this.#resolveProviderErrors().custom({
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

  async #ethAccountsBestEffort() {
    if (this.#initialized) return;
    if (this.#state.accounts.length) return;

    this.#kickoffConnect();

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

  #buildRequestArgs(method: string, params?: RequestArguments["params"]): RequestArguments {
    return params === undefined ? { method } : { method, params };
  }

  #toRpcError(error: unknown): EIP1193ProviderRpcError {
    if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
      return error as EIP1193ProviderRpcError;
    }
    return this.#resolveRpcErrors().internal({
      message: error instanceof Error ? error.message : String(error),
      data: { originalError: error },
    });
  }

  #resolveRequestTimeoutMs(method: string): number {
    if (this.#approvalMethods.has(method)) return this.#approvalTimeoutMs;
    if (this.#readonlyMethods.has(method)) return this.#readonlyTimeoutMs;
    if (method.startsWith("eth_get") || method === "eth_call") return this.#readonlyTimeoutMs;
    return this.#normalTimeoutMs;
  }

  request = async (args: RequestArguments) => {
    const rpcErrors = this.#resolveRpcErrors();
    const providerErrors = this.#resolveProviderErrors();
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

    if (PROVIDER_STATE_METHODS.has(method)) {
      return this.getProviderState();
    }

    if (method === "eth_accounts") {
      if (!this.#initialized) {
        await this.#ethAccountsBestEffort();
      }
      return this.#state.accounts;
    }

    if (!this.#initialized && READONLY_EARLY.has(method)) {
      if (method === "eth_chainId") {
        if (this.chainId) return this.chainId;
        try {
          await this.#waitForReady();
        } catch (error) {
          throw this.#toRpcError(error);
        }
        if (this.chainId) return this.chainId;
        throw providerErrors.disconnected();
      }
    }

    if (!this.#initialized) {
      try {
        await this.#waitForReady();
      } catch (error) {
        throw this.#toRpcError(error);
      }
    }

    try {
      const timeoutMs = this.#resolveRequestTimeoutMs(method);
      const result = await this.#transport.request(args, { timeoutMs });
      if (method === "eth_requestAccounts" && Array.isArray(result)) {
        const next = result.filter((item): item is string => typeof item === "string");
        this.#applyPatch({ type: "accounts", accounts: next }, { emit: true });
      }
      return result;
    } catch (error) {
      throw this.#toRpcError(error);
    }
  };

  enable = async () => {
    const rpcErrors = this.#resolveRpcErrors();
    const result = await this.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
      throw rpcErrors.internal({
        message: "eth_requestAccounts did not return an array of accounts",
        data: { result },
      });
    }
    return result;
  };

  send = (methodOrPayload: string | LegacyPayload, paramsOrCallback?: unknown) => {
    if (typeof methodOrPayload === "string") {
      return this.request(this.#buildRequestArgs(methodOrPayload, paramsOrCallback as RequestArguments["params"]));
    }

    if (isLegacyCallback(paramsOrCallback)) {
      this.sendAsync(methodOrPayload, paramsOrCallback);
      return;
    }

    return this.request(this.#buildRequestArgs(methodOrPayload.method, methodOrPayload.params));
  };

  sendAsync = (payload: LegacyPayload, callback: LegacyCallback) => {
    const requestArgs = this.#buildRequestArgs(payload.method, payload.params);
    const id = String(payload.id ?? Date.now());
    const jsonrpc = payload.jsonrpc ?? "2.0";
    this.request(requestArgs)
      .then((result) => {
        callback(null, { id, jsonrpc, result });
      })
      .catch((error) => {
        const rpcError = this.#toRpcError(error);
        callback(rpcError, { id, jsonrpc, error: rpcError });
      });
  };

  destroy() {
    this.#transport.removeListener("connect", this.#handleTransportConnect);
    this.#transport.removeListener("disconnect", this.#handleTransportDisconnect);
    this.#transport.removeListener("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.removeListener("chainChanged", this.#handleTransportChainChanged);
    this.#transport.removeListener("unlockStateChanged", this.#handleUnlockStateChanged);
    this.#transport.removeListener("metaChanged", this.#handleMetaChanged);
    this.removeAllListeners();
  }
}
