import type { JsonRpcParams, JsonRpcRequest, JsonRpcVersion2 } from "@arx/core";
import { getProviderErrors, getRpcErrors } from "@arx/core/errors";
import { EventEmitter } from "eventemitter3";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "./types/eip1193.js";
import type { Transport } from "./types/transport.js";

const PROVIDER_INFO = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,...",
  rdns: "wallet.arx",
} as const;

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

const DEFAULT_NAMESPACE = "eip155";

export class EthereumProvider extends EventEmitter implements EIP1193Provider {
  #namespace = DEFAULT_NAMESPACE;
  readonly isArx = true;
  #transport: Transport;
  #initialized = false;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;

  #initializedResolve?: (() => void) | undefined;
  #initializedReject?: ((reason?: unknown) => void) | undefined;
  #initializedPromise!: Promise<void>;

  #resolveProviderErrors = () => getProviderErrors(this.#namespace);
  #resolveRpcErrors = () => getRpcErrors(this.#namespace);

  constructor({ transport }: { transport: Transport }) {
    super();
    this.#transport = transport;
    this.#createInitializationPromise();

    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
    this.#transport.on("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.on("chainChanged", this.#handleTransportChainChanged);
    this.#transport.on("unlockStateChanged", this.#handleUnlockStateChanged);

    this.#syncWithTransportState();
  }
  static readonly providerInfo = PROVIDER_INFO;

  get caip2() {
    return this.#caip2;
  }

  get isUnlocked() {
    return this.#isUnlocked;
  }

  get chainId() {
    return this.#chainId;
  }

  get selectedAddress() {
    return this.#accounts[0] ?? null;
  }

  isConnected = () => {
    return this.#transport.isConnected();
  };

  #createInitializationPromise() {
    this.#initializedPromise = new Promise((resolve, reject) => {
      this.#initializedResolve = resolve;
      this.#initializedReject = reject;
    });
  }

  #syncWithTransportState() {
    const state = this.#transport.getConnectionState();

    this.#updateNamespace(state.caip2 ?? null);

    if (typeof state.chainId === "string") {
      this.#updateChain(state.chainId);
    }

    if (state.accounts.length) {
      this.#updateAccounts(state.accounts.filter((item): item is string => typeof item === "string"));
    }

    if (typeof state.isUnlocked === "boolean") {
      this.#isUnlocked = state.isUnlocked;
    }

    if (state.connected) {
      this.#markInitialized();
    }
  }

  #updateNamespace(caip2: string | null | undefined) {
    if (caip2 === undefined) return;

    if (typeof caip2 === "string" && caip2.length > 0) {
      this.#caip2 = caip2;
      const [namespace] = caip2.split(":");
      this.#namespace = namespace ?? DEFAULT_NAMESPACE;
      return;
    }

    this.#caip2 = null;
    this.#namespace = DEFAULT_NAMESPACE;
  }

  #markInitialized() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#initializedResolve?.();
      this.#initializedReject = undefined;

      this.emit("_initialized");
    }
  }

  #updateChain(chainId: string | null) {
    this.#chainId = chainId;
  }

  #updateAccounts(accounts: string[]) {
    this.#accounts = accounts;
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
    }>;

    this.#updateNamespace(data.caip2 ?? null);

    if (typeof data.chainId === "string") {
      this.#updateChain(data.chainId);
    }

    if (Array.isArray(data.accounts)) {
      this.#updateAccounts(data.accounts.filter((item): item is string => typeof item === "string"));
    }
    if (typeof data.isUnlocked === "boolean") {
      this.#isUnlocked = data.isUnlocked;
    }

    this.#markInitialized();

    if (this.#chainId) {
      this.emit("connect", { chainId: this.#chainId });
    }

    if (this.#accounts.length) {
      this.emit("accountsChanged", [...this.#accounts]);
    }
  };

  #handleTransportChainChanged = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;

    const { chainId, caip2, isUnlocked } = payload as Partial<{
      chainId: unknown;
      caip2: unknown;
      isUnlocked: unknown;
    }>;

    if (typeof chainId !== "string") return;

    this.#updateChain(chainId);
    this.#updateNamespace(typeof caip2 === "string" || caip2 === null ? (caip2 as string | null) : undefined);

    if (typeof isUnlocked === "boolean") {
      this.#isUnlocked = isUnlocked;
    }

    this.emit("chainChanged", this.#chainId);
  };

  #handleTransportAccountsChanged = (accounts: unknown) => {
    if (!Array.isArray(accounts)) return;
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#updateAccounts(next);
    this.emit("accountsChanged", [...this.#accounts]);
  };

  #handleUnlockStateChanged = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const { isUnlocked } = payload as { isUnlocked?: unknown };
    if (typeof isUnlocked !== "boolean") return;
    this.#isUnlocked = isUnlocked;
    this.emit("unlockStateChanged", { isUnlocked });
  };

  #handleTransportDisconnect = (error?: unknown) => {
    const disconnectError = error ?? this.#resolveProviderErrors().disconnected();

    this.#resetInitialization(disconnectError);
    this.#updateChain(null);
    this.#updateAccounts([]);
    this.#updateNamespace(null);
    this.#isUnlocked = null;

    this.emit("disconnect", disconnectError);
  };

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

    if (!this.#initialized) {
      try {
        await this.#initializedPromise;
      } catch (error) {
        throw this.#toRpcError(error);
      }
    }

    try {
      const result = await this.#transport.request(args);
      if (method === "eth_requestAccounts" && Array.isArray(result)) {
        const next = result.filter((item): item is string => typeof item === "string");
        this.#updateAccounts(next);
        this.emit("accountsChanged", [...this.#accounts]);
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
    this.removeAllListeners();
  }
}
