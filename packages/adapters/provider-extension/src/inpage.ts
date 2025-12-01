import { getProviderErrors } from "@arx/core";
import { EventEmitter } from "@arx/provider-core";
import type {
  EIP1193ProviderRpcError,
  RequestArguments,
  Transport,
  TransportMeta,
  TransportRequest,
  TransportResponse,
  TransportState,
} from "@arx/provider-core/types";
import { CHANNEL } from "./constants.js";
import type { Envelope } from "./types.js";

type ConnectPayload = {
  chainId: string;
  caip2?: string;
  accounts: string[];
  isUnlocked?: boolean;
  meta?: TransportMeta | null;
};
type ChainUpdatePayload = { chainId: string; caip2?: string | null; isUnlocked?: boolean; meta?: TransportMeta | null };

const cloneTransportMeta = (meta: TransportMeta): TransportMeta => ({
  activeChain: meta.activeChain,
  activeNamespace: meta.activeNamespace,
  supportedChains: [...meta.supportedChains],
});

export class InpageTransport extends EventEmitter implements Transport {
  #connected = false;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;
  #meta: TransportMeta | null = null;
  #timeoutMs = 120_000;
  #pendingRequests = new Map<
    string,
    {
      resolve: (value: TransportResponse) => void;
      reject: (reason?: EIP1193ProviderRpcError) => void;
      timer?: number;
    }
  >();

  #id = 0n;

  #handshakePromise: Promise<void> | null = null;
  #handshakeResolve?: (() => void) | undefined;
  #handshakeReject?: ((reason?: unknown) => void) | undefined;

  constructor() {
    super();

    window.addEventListener("message", this.#handleMessage);
  }

  getConnectionState(): TransportState {
    return {
      connected: this.#connected,
      chainId: this.#chainId,
      caip2: this.#caip2,
      accounts: [...this.#accounts],
      isUnlocked: this.#isUnlocked,
      meta: this.#meta ? cloneTransportMeta(this.#meta) : null,
    };
  }

  #resolveHandshake() {
    if (!this.#handshakePromise) return;

    this.#handshakeResolve?.();
    this.#handshakePromise = null;
    this.#handshakeResolve = undefined;
    this.#handshakeReject = undefined;
  }

  #rejectHandshake(error?: unknown) {
    if (!this.#handshakePromise) return;
    this.#handshakeReject?.(error);
    this.#handshakePromise = null;
    this.#handshakeResolve = undefined;
    this.#handshakeReject = undefined;
  }

  #getProviderErrors() {
    const namespace = this.#meta?.activeNamespace ?? this.#caip2 ?? undefined;
    return getProviderErrors(namespace);
  }

  #setConnection(payload: ConnectPayload, options?: { emitConnect?: boolean }) {
    const accounts = Array.isArray(payload.accounts)
      ? payload.accounts.filter((item): item is string => typeof item === "string")
      : [];
    this.#connected = true;
    this.#caip2 = payload.caip2 ?? null;
    this.#chainId = payload.chainId;
    this.#accounts = accounts;
    this.#isUnlocked = typeof payload.isUnlocked === "boolean" ? payload.isUnlocked : null;
    this.#meta = payload.meta ? cloneTransportMeta(payload.meta) : null;

    this.#resolveHandshake();
    if (options?.emitConnect ?? true) {
      this.emit("connect", {
        chainId: payload.chainId,
        ...(this.#caip2 ? { caip2: this.#caip2 } : {}),
        accounts,
        ...(this.#isUnlocked !== null ? { isUnlocked: this.#isUnlocked } : {}),
        ...(this.#meta ? { meta: cloneTransportMeta(this.#meta) } : {}),
      });
    }
  }
  #setAccounts(accounts: string[]) {
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#accounts = next;
    this.emit("accountsChanged", next);
  }

  #setChain(update: ChainUpdatePayload) {
    if (typeof update.chainId !== "string") {
      return;
    }

    this.#chainId = update.chainId;
    if (update.caip2 !== undefined) {
      this.#caip2 = update.caip2 ?? null;
    }
    if (typeof update.isUnlocked === "boolean") {
      this.#isUnlocked = update.isUnlocked;
    }
    if (update.meta !== undefined) {
      this.#meta = update.meta ? cloneTransportMeta(update.meta) : null;
    }

    this.emit("chainChanged", {
      chainId: this.#chainId,
      ...(this.#caip2 ? { caip2: this.#caip2 } : {}),
      ...(this.#isUnlocked !== null ? { isUnlocked: this.#isUnlocked } : {}),
      ...(this.#meta ? { meta: cloneTransportMeta(this.#meta) } : {}),
    });
  }

  #handleDisconnect = (reason?: unknown) => {
    if (!this.#connected && !this.#handshakePromise) {
      return;
    }
    const providerErrors = this.#getProviderErrors();
    const error =
      reason && typeof reason === "object" && "code" in (reason as Record<string, unknown>)
        ? (reason as EIP1193ProviderRpcError)
        : providerErrors.disconnected();

    this.#connected = false;
    this.#caip2 = null;
    this.#chainId = null;
    this.#accounts = [];
    this.#isUnlocked = null;
    this.#meta = null;

    this.#rejectHandshake(error);
    for (const [id, { reject }] of this.#pendingRequests) {
      reject(error);
      this.#pendingRequests.delete(id);
    }
    this.emit("disconnect", error);
  };

  async request(args: RequestArguments): Promise<unknown> {
    if (!this.#connected) {
      throw this.#getProviderErrors().disconnected();
    }

    const { method, params = [] } = args;

    const request: TransportRequest = {
      id: (this.#id++).toString(),
      jsonrpc: "2.0",
      method,
      params,
    };
    const id = request.id as string;
    const env: Envelope = { channel: CHANNEL, type: "request", id, payload: request };

    const rpc = await new Promise<TransportResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject({ code: 408, message: "Request timed out" });
      }, this.#timeoutMs);

      this.#pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
        timer,
      });
      window.postMessage(env, "*");
    });

    if ("error" in rpc) {
      throw Object.assign(new Error(rpc.error.message), {
        code: rpc.error.code,
        data: rpc.error.data,
      });
    }
    return rpc.result;
  }

  #handleMessage = (event: MessageEvent) => {
    if (event.source !== window) return;

    const data = event.data as Envelope | undefined;

    if (!data || typeof data !== "object" || data?.channel !== CHANNEL) return;

    switch (data.type) {
      case "handshake_ack": {
        const shouldUpdate = this.#shouldRefreshConnection(data.payload);
        if (shouldUpdate) {
          this.#setConnection(data.payload, { emitConnect: true });
        } else {
          this.#resolveHandshake();
        }
        break;
      }

      case "response": {
        const { id, payload } = data;
        const entry = this.#pendingRequests.get(id);
        if (!entry) return;
        this.#pendingRequests.delete(id);
        entry.resolve(payload);
        break;
      }

      case "event": {
        const { event: eventName, params = [] } = data.payload;

        switch (eventName) {
          case "accountsChanged": {
            const [accounts] = params;
            if (Array.isArray(accounts)) {
              this.#setAccounts(accounts);
            }
            break;
          }
          case "chainChanged": {
            const [payload] = params;
            if (
              payload &&
              typeof payload === "object" &&
              typeof (payload as { chainId?: unknown }).chainId === "string"
            ) {
              this.#setChain(payload as ChainUpdatePayload);
            }
            break;
          }
          case "session:locked": {
            this.#isUnlocked = false;
            if (this.#chainId) {
              this.#setChain({ chainId: this.#chainId, caip2: this.#caip2 ?? null, isUnlocked: false });
            }
            this.#setAccounts([]);
            this.emit("unlockStateChanged", { isUnlocked: false, payload: params[0] });
            break;
          }
          case "session:unlocked": {
            this.#isUnlocked = true;
            if (this.#chainId) {
              this.#setChain({ chainId: this.#chainId, caip2: this.#caip2 ?? null, isUnlocked: true });
            }
            this.emit("unlockStateChanged", { isUnlocked: true, payload: params[0] });
            break;
          }
          case "disconnect":
            this.#handleDisconnect(params[0]);
            break;

          default:
            this.emit(eventName, ...params);
        }

        break;
      }

      case "request":
      case "handshake":
        // inpage should not receive request/handshake
        break;

      default:
        // ignore unknown
        break;
    }
  };

  #shouldRefreshConnection(payload: ConnectPayload) {
    const payloadAccounts = Array.isArray(payload.accounts)
      ? payload.accounts.filter((item): item is string => typeof item === "string")
      : [];
    const payloadUnlocked = typeof payload.isUnlocked === "boolean" ? payload.isUnlocked : null;
    const sameAccounts =
      this.#accounts.length === payloadAccounts.length &&
      this.#accounts.every((value, index) => value === payloadAccounts[index]);
    const payloadMeta = payload.meta ? cloneTransportMeta(payload.meta) : null;
    const sameMeta =
      (this.#meta === null && payloadMeta === null) ||
      (this.#meta &&
        payloadMeta &&
        this.#meta.activeChain === payloadMeta.activeChain &&
        this.#meta.activeNamespace === payloadMeta.activeNamespace &&
        this.#meta.supportedChains.length === payloadMeta.supportedChains.length &&
        this.#meta.supportedChains.every((value, index) => value === payloadMeta.supportedChains[index]));

    return (
      !this.#connected ||
      this.#chainId !== payload.chainId ||
      (this.#caip2 ?? null) !== (payload.caip2 ?? null) ||
      !sameAccounts ||
      (this.#isUnlocked ?? null) !== payloadUnlocked ||
      !sameMeta
    );
  }

  isConnected(): boolean {
    return this.#connected;
  }

  connect = async () => {
    if (this.#connected) {
      return;
    }
    if (this.#handshakePromise) {
      return this.#handshakePromise;
    }

    this.#handshakePromise = new Promise<void>((resolve, reject) => {
      this.#handshakeResolve = resolve;
      this.#handshakeReject = reject;
    });

    const msg: Envelope = {
      channel: CHANNEL,
      type: "handshake",
      payload: { version: "2.0" },
    };
    window.postMessage(msg, "*");

    await this.#handshakePromise;
  };

  disconnect = async () => {
    window.removeEventListener("message", this.#handleMessage);
    this.#handleDisconnect();
  };
  destroy = () => {
    window.removeEventListener("message", this.#handleMessage);
    this.removeAllListeners();
  };
}
