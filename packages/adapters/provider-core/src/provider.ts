import { EventEmitter } from "eventemitter3";
import { evmProviderErrors, evmRpcErrors } from "./errors.js";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "./types/eip1193.js";
import type { JsonRpcRequest, JsonRpcResponse, Transport } from "./types/transport.js";

const PROVIDER_INFO = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,...",
  rdns: "wallet.arx",
} as const;

type LegacyCallback = (error: EIP1193ProviderRpcError | null, response: JsonRpcResponse | undefined) => void;

type LegacyPayload = Partial<Pick<JsonRpcRequest, "id" | "jsonrpc">> & Pick<JsonRpcRequest, "method" | "params">;

const isLegacyCallback = (value: unknown): value is LegacyCallback => typeof value === "function";

export class EthereumProvider extends EventEmitter implements EIP1193Provider {
  #listenersBound = false;

  #initializedResolve?: () => void;
  #initializedPromise: Promise<void>;

  constructor({ transport }: { transport: Transport }) {
    super();
    this.#transport = transport;
    this.#transport.on("connect", this.#handleTransportConnect);
    this.#transport.on("disconnect", this.#handleTransportDisconnect);
    this.#transport.on("accountsChanged", this.#handleTransportAccountsChanged);
    this.#transport.on("chainChanged", this.#handleTransportChainChanged);

    this.#initializedPromise = new Promise((resolve) => {
      this.#initializedResolve = resolve;
    });
  }
  static readonly providerInfo = PROVIDER_INFO;

  readonly isArx = true;

  #transport: Transport;
  #chainId: string | null = null;

  #accounts: string[] = [];

  #initialized = false;

  isConnected = () => {
    return this.#transport.isConnected();
  };

  get chainId() {
    return this.#chainId;
  }

  get selectedAddress() {
    return this.#accounts[0] ?? null;
  }

  #markInitialized() {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#initializedResolve?.();
      this.emit("_initialized");
    }
  }

  #updateChain(chainId: string | null) {
    this.#chainId = chainId;
  }

  #updateAccounts(accounts: string[]) {
    this.#accounts = accounts;
  }

  #resetInitialization() {
    this.#initialized = false;
    this.#initializedPromise = new Promise((resolve) => {
      this.#initializedResolve = resolve;
    });
  }

  #handleTransportConnect = (payload: unknown) => {
    const data = (payload ?? {}) as Partial<{ chainId: string; accounts: string[]; isUnlocked: boolean }>;
    if (data.chainId) this.#updateChain(data.chainId);
    if (Array.isArray(data.accounts)) this.#updateAccounts(data.accounts);
    this.#markInitialized();
    if (this.#chainId) this.emit("connect", { chainId: this.#chainId });
    if (this.#accounts.length) this.emit("accountsChanged", [...this.#accounts]);
  };

  #handleTransportChainChanged = (chainId: unknown) => {
    if (typeof chainId !== "string") return;
    this.#updateChain(chainId);
    this.emit("chainChanged", chainId);
  };

  #handleTransportAccountsChanged = (accounts: unknown) => {
    if (!Array.isArray(accounts)) return;
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#updateAccounts(next);
    this.emit("accountsChanged", [...this.#accounts]);
  };

  #handleTransportDisconnect = (error?: unknown) => {
    this.#resetInitialization();
    this.#updateChain(null);
    this.#updateAccounts([]);
    this.emit("disconnect", error);
  };

  #buildRequestArgs(method: string, params?: RequestArguments["params"]): RequestArguments {
    return params === undefined ? { method } : { method, params };
  }

  #toRpcError(error: unknown): EIP1193ProviderRpcError {
    if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
      return error as EIP1193ProviderRpcError;
    }
    return evmRpcErrors.internal({
      message: error instanceof Error ? error.message : String(error),
      data: { originalError: error },
    });
  }

  request = async (args: RequestArguments) => {
    const { method } = args;

    if (!this.#initialized) {
      if (method !== "eth_requestAccounts") {
        throw evmProviderErrors.disconnected();
      }
      await this.#initializedPromise;
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
    const result = await this.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
      throw evmRpcErrors.internal({
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
    this.removeAllListeners();
  }
}
