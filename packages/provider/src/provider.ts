import type { JsonRpcParams, JsonRpcRequest, JsonRpcVersion2 } from "@arx/core";
import { getProviderErrors, getRpcErrors } from "@arx/core/errors";
import { EventEmitter } from "eventemitter3";
import type { EIP1193Provider, EIP1193ProviderRpcError, RequestArguments } from "./types/eip1193.js";
import type { Transport, TransportMeta } from "./types/transport.js";

const DEFAULT_NAMESPACE = "eip155" as const;

const PROVIDER_INFO = {
  uuid: "90ef60ca-8ea5-4638-b577-6990dc93ef2f",
  name: "ARX Wallet",
  icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgICA8ZGVmcz4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImRhcmtTcGFjZSIgeDE9IjAiIHkxPSIwIiB4Mj0iMjAwIiB5Mj0iMjAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzNBM0EzQSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNTA1MDUiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPC9kZWZzPgogICAgPHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0NSIgZmlsbD0idXJsKCNkYXJrU3BhY2UpIi8+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEwMCAzMEw0MCAxNzBINzVMMTAwIDExMEwxMjUgMTcwSDE2MEwxMDAgMzBaTTEwMCA5NUwxMTUgMTM1SDg1TDEwMCA5NVoiIGZpbGw9IiNGRkZGRkYiLz4KPC9zdmc+Cg==",
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

const cloneTransportMeta = (meta: TransportMeta): TransportMeta => ({
  activeChain: meta.activeChain,
  activeNamespace: meta.activeNamespace,
  supportedChains: [...meta.supportedChains],
});
const PROVIDER_STATE_METHODS = new Set(["metamask_getProviderState", "wallet_getProviderState"]);
const READONLY_EARLY = new Set(["eth_chainId", "eth_accounts"]);

const DEFAULT_READY_TIMEOUT_MS = 5000;

type ProviderStateSnapshot = {
  accounts: string[];
  chainId: string | null;
  networkVersion: string | null;
  isUnlocked: boolean;
};

type ProviderSnapshot = {
  connected: boolean;
  chainId: string | null;
  caip2: string | null;
  accounts: string[];
  isUnlocked: boolean | null;
  meta: TransportMeta | null;
};

type ProviderPatch =
  | { type: "accounts"; accounts: string[] }
  | { type: "chain"; chainId: string; caip2?: string | null; isUnlocked?: boolean; meta?: TransportMeta | null }
  | { type: "unlock"; isUnlocked: boolean }
  | { type: "meta"; meta: TransportMeta | null };

type ApplyOptions = { emit?: boolean };

export class EthereumProvider extends EventEmitter implements EIP1193Provider {
  #namespace = DEFAULT_NAMESPACE;
  readonly isArx = true;
  #transport: Transport;
  #initialized = false;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;
  #meta: TransportMeta | null = null;

  #initializedResolve?: (() => void) | undefined;
  #initializedReject?: ((reason?: unknown) => void) | undefined;
  #initializedPromise!: Promise<void>;

  #readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS;
  #connectInFlight: Promise<void> | null = null;

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
    this.#transport.on("metaChanged", this.#handleMetaChanged);

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

  /**
   * Mirrors MetaMask provider snapshot so dapps can bootstrap without extra RPC.
   */
  getProviderState = (): ProviderStateSnapshot => ({
    accounts: [...this.#accounts],
    chainId: this.#chainId,
    networkVersion: this.#resolveNetworkVersion(),
    isUnlocked: this.#isUnlocked ?? false,
  });

  #resolveNumericReference(candidate: string | null | undefined) {
    if (typeof candidate !== "string" || candidate.length === 0) return null;
    const [, reference = candidate] = candidate.split(":");
    return /^\d+$/.test(reference) ? reference : null;
  }

  #resolveNetworkVersion(): string | null {
    if (typeof this.#chainId === "string") {
      try {
        return BigInt(this.#chainId).toString(10);
      } catch {
        // swallow malformed hex to fall back on CAIP references
      }
    }
    return this.#resolveNumericReference(this.#caip2) ?? this.#resolveNumericReference(this.#meta?.activeChain);
  }

  #handleMetaChanged = (payload: unknown) => {
    if (payload === undefined) return;
    this.#applyPatch({ type: "meta", meta: (payload ?? null) as TransportMeta | null }, { emit: false });
  };
  #applySnapshot(snapshot: ProviderSnapshot, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;

    const wasInitialized = this.#initialized;
    const prevAccounts = [...this.#accounts];

    this.#updateMeta(snapshot.meta);
    const effectiveCaip2 = this.#resolveEffectiveCaip2(snapshot.caip2);
    this.#updateNamespace(effectiveCaip2);

    this.#updateChain(snapshot.chainId);
    this.#updateAccounts(snapshot.accounts);
    this.#isUnlocked = typeof snapshot.isUnlocked === "boolean" ? snapshot.isUnlocked : null;

    if (snapshot.connected) {
      this.#markInitialized();
    }

    if (!emit) return;

    const didInitialize = !wasInitialized && this.#initialized;
    if (didInitialize && this.#chainId) {
      this.emit("connect", { chainId: this.#chainId });
    }

    const accountsChanged =
      prevAccounts.length !== this.#accounts.length ||
      prevAccounts.some((value, index) => value !== this.#accounts[index]);
    if (accountsChanged) {
      this.emit("accountsChanged", [...this.#accounts]);
    }
  }

  #applyPatch(patch: ProviderPatch, options: ApplyOptions = {}) {
    const emit = options.emit ?? true;

    const prevChainId = this.#chainId;
    const prevAccounts = [...this.#accounts];
    const prevUnlock = this.#isUnlocked;

    switch (patch.type) {
      case "meta": {
        this.#updateMeta(patch.meta);
        break;
      }

      case "accounts": {
        this.#updateAccounts(patch.accounts);
        break;
      }

      case "unlock": {
        this.#isUnlocked = patch.isUnlocked;
        break;
      }

      case "chain": {
        if (patch.meta !== undefined) {
          this.#updateMeta(patch.meta);
        }
        const effectiveCaip2 = this.#resolveEffectiveCaip2(patch.caip2);
        this.#updateNamespace(effectiveCaip2);

        this.#updateChain(patch.chainId);

        if (typeof patch.isUnlocked === "boolean") {
          this.#isUnlocked = patch.isUnlocked;
        }
        break;
      }

      default: {
        const _exhaustive: never = patch;
        return _exhaustive;
      }
    }

    if (!emit) return;

    if (patch.type === "chain" && prevChainId !== this.#chainId && this.#chainId) {
      this.emit("chainChanged", this.#chainId);
    }

    if (patch.type === "accounts") {
      const accountsChanged =
        prevAccounts.length !== this.#accounts.length ||
        prevAccounts.some((value, index) => value !== this.#accounts[index]);
      if (accountsChanged) {
        this.emit("accountsChanged", [...this.#accounts]);
      }
    }

    if (patch.type === "unlock" && prevUnlock !== this.#isUnlocked) {
      this.emit("unlockStateChanged", { isUnlocked: patch.isUnlocked });
    }
  }

  #createInitializationPromise() {
    this.#initializedPromise = new Promise((resolve, reject) => {
      this.#initializedResolve = resolve;
      this.#initializedReject = reject;
    });
  }
  #syncWithTransportState() {
    const state = this.#transport.getConnectionState();

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

  #updateMeta(meta: TransportMeta | null | undefined) {
    // undefined means "no change"; null clears the cached meta snapshot.
    if (meta === undefined) return;
    this.#meta = meta ? cloneTransportMeta(meta) : null;
  }

  #resolveEffectiveCaip2(candidate: unknown): string | null {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    return this.#meta?.activeChain ?? null;
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
    this.#applySnapshot(
      {
        connected: false,
        chainId: null,
        caip2: null,
        accounts: [],
        isUnlocked: null,
        meta: null,
      },
      { emit: false },
    );

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

    if (PROVIDER_STATE_METHODS.has(method)) {
      return this.getProviderState();
    }

    if (!this.#initialized && READONLY_EARLY.has(method)) {
      if (method === "eth_chainId") {
        if (this.#chainId) return this.#chainId;
        try {
          await this.#waitForReady();
        } catch (error) {
          throw this.#toRpcError(error);
        }
        if (this.#chainId) return this.#chainId;
        throw providerErrors.disconnected();
      }
      if (method === "eth_accounts") {
        return [];
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
      const result = await this.#transport.request(args);
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
