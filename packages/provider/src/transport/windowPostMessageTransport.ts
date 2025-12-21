import { getProviderErrors, getRpcErrors } from "@arx/core/errors";
import { EventEmitter } from "eventemitter3";
import { CHANNEL } from "../protocol/channel.js";
import { type Envelope, isEnvelope, resolveProtocolVersion } from "../protocol/envelope.js";
import { PROTOCOL_VERSION } from "../protocol/version.js";
import type { EIP1193ProviderRpcError, RequestArguments } from "../types/eip1193.js";
import type {
  Transport,
  TransportMeta,
  TransportRequest,
  TransportRequestOptions,
  TransportResponse,
  TransportState,
} from "../types/transport.js";
import { cloneTransportMeta, isTransportMeta } from "../utils/transportMeta.js";

type ConnectPayload = Extract<Envelope, { type: "handshake_ack" }>["payload"];
type ChainUpdatePayload = { chainId: string; caip2?: string | null; isUnlocked?: boolean; meta?: TransportMeta | null };

export type WindowPostMessageTransportOptions = {
  handshakeTimeoutMs?: number;
};

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8000;

const isConnectPayload = (value: unknown): value is ConnectPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConnectPayload>;
  if (typeof candidate.handshakeId !== "string") return false;
  if (typeof candidate.chainId !== "string") return false;
  if (typeof candidate.caip2 !== "string") return false;
  if (typeof candidate.isUnlocked !== "boolean") return false;
  if (!Array.isArray(candidate.accounts) || !candidate.accounts.every((a) => typeof a === "string")) return false;
  if (!isTransportMeta(candidate.meta)) return false;
  return true;
};

const createId = (): string => {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class WindowPostMessageTransport extends EventEmitter implements Transport {
  #connected = false;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
  #isUnlocked: boolean | null = null;
  #meta: TransportMeta | null = null;
  #requestTimeoutMs = 120_000;
  #handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS;
  #handshakeId: string | null = null;
  #sessionId: string;
  #pendingRequests = new Map<
    string,
    {
      resolve: (value: TransportResponse) => void;
      reject: (reason?: EIP1193ProviderRpcError) => void;
      timeoutId?: number;
    }
  >();

  #id = 0n;

  #handshakePromise: Promise<void> | null = null;
  #handshakeResolve?: (() => void) | undefined;
  #handshakeReject?: ((reason?: unknown) => void) | undefined;
  #handshakeTimeoutId: number | undefined;

  constructor(options: WindowPostMessageTransportOptions = {}) {
    super();

    const { handshakeTimeoutMs } = options;
    if (handshakeTimeoutMs) {
      this.#handshakeTimeoutMs = handshakeTimeoutMs;
    }

    // session is rotated per `connect()` attempt (not per instance lifetime).
    this.#sessionId = createId();
    window.addEventListener("message", this.#handleWindowMessage);
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

  isConnected(): boolean {
    return this.#connected;
  }

  async request(args: RequestArguments, options?: TransportRequestOptions): Promise<unknown> {
    if (!this.#connected) {
      throw this.#getProviderErrors().disconnected();
    }

    const { method, params } = args;

    const request: TransportRequest = {
      id: (this.#id++).toString(),
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    const id = request.id as string;
    const envelope: Envelope = {
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "request",
      id,
      payload: request,
    };

    const rpc = await new Promise<TransportResponse>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.#requestTimeoutMs;
      const timeoutId = window.setTimeout(() => {
        this.#pendingRequests.delete(id);
        const namespace = this.#meta?.activeNamespace ?? this.#caip2 ?? undefined;
        reject(getRpcErrors(namespace).internal({ message: "Request timed out" }));
      }, timeoutMs);

      this.#pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeoutId);
          reject(reason);
        },
        timeoutId,
      });

      window.postMessage(envelope, window.location.origin);
    });

    if ("error" in rpc) {
      throw Object.assign(new Error(rpc.error.message), {
        code: rpc.error.code,
        data: rpc.error.data,
      });
    }
    return rpc.result;
  }

  retryConnect = async () => {
    if (this.#connected) return;
    if (this.#handshakePromise) {
      this.#sendHandshake();
      return this.#handshakePromise;
    }
    return this.connect();
  };

  connect = async () => {
    if (this.#connected) {
      return;
    }
    if (this.#handshakePromise) {
      return this.#handshakePromise;
    }

    // Start a fresh session for each (re)connect attempt to isolate stale messages.
    this.#sessionId = createId();
    this.#handshakeId = createId();
    this.#handshakePromise = new Promise<void>((resolve, reject) => {
      this.#handshakeResolve = resolve;
      this.#handshakeReject = reject;
    });

    this.#handshakeTimeoutId = window.setTimeout(() => {
      const providerErrors = this.#getProviderErrors();
      this.#handshakeId = null;
      this.#rejectHandshake(
        providerErrors.custom({
          code: 4900,
          message: "Handshake timed out. Try again.",
        }),
      );
    }, this.#handshakeTimeoutMs);

    this.#sendHandshake();

    await this.#handshakePromise;
  };

  disconnect = async () => {
    this.#handleDisconnect();
  };

  destroy = () => {
    this.#handleDisconnect();
    window.removeEventListener("message", this.#handleWindowMessage);
    this.removeAllListeners();
  };

  #normalizeAccounts(accounts: unknown): string[] {
    if (!Array.isArray(accounts)) return [];
    return accounts.filter((item): item is string => typeof item === "string");
  }

  #getProviderErrors() {
    const namespace = this.#meta?.activeNamespace ?? this.#caip2 ?? undefined;
    return getProviderErrors(namespace);
  }

  #applyHandshakePayload(payload: ConnectPayload, options?: { emitConnect?: boolean }) {
    const accounts = this.#normalizeAccounts(payload.accounts);
    this.#connected = true;
    this.#caip2 = payload.caip2;
    this.#chainId = payload.chainId;
    this.#accounts = accounts;
    this.#isUnlocked = payload.isUnlocked;
    this.#meta = isTransportMeta(payload.meta) ? cloneTransportMeta(payload.meta) : null;

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

  #updateAccounts(accounts: string[]) {
    const next = this.#normalizeAccounts(accounts);
    this.#accounts = next;
    this.emit("accountsChanged", next);
  }

  #updateChain(update: ChainUpdatePayload) {
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
      this.#meta = update.meta && isTransportMeta(update.meta) ? cloneTransportMeta(update.meta) : null;
    }

    this.emit("chainChanged", {
      chainId: this.#chainId,
      ...(this.#caip2 ? { caip2: this.#caip2 } : {}),
      ...(this.#isUnlocked !== null ? { isUnlocked: this.#isUnlocked } : {}),
      ...(this.#meta ? { meta: cloneTransportMeta(this.#meta) } : {}),
    });
  }

  #clearHandshakeTimeout() {
    if (this.#handshakeTimeoutId === undefined) return;
    window.clearTimeout(this.#handshakeTimeoutId);
    this.#handshakeTimeoutId = undefined;
  }

  #resolveHandshake() {
    if (!this.#handshakePromise) return;

    this.#clearHandshakeTimeout();
    this.#handshakeResolve?.();
    this.#handshakePromise = null;
    this.#handshakeResolve = undefined;
    this.#handshakeReject = undefined;
  }

  #rejectHandshake(error?: unknown) {
    if (!this.#handshakePromise) return;

    this.#clearHandshakeTimeout();
    this.#handshakeReject?.(error);
    this.#handshakePromise = null;
    this.#handshakeResolve = undefined;
    this.#handshakeReject = undefined;
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
    this.#handshakeId = null;
    this.#sessionId = createId();

    this.#rejectHandshake(error);
    for (const [id, { reject }] of this.#pendingRequests) {
      reject(error);
      this.#pendingRequests.delete(id);
    }
    this.emit("disconnect", error);
  };

  #handleHandshakeAckMessage = (payload: unknown) => {
    if (!this.#handshakePromise) return;
    if (!this.#handshakeId) return;
    if (!isConnectPayload(payload)) return;
    if (payload.handshakeId !== this.#handshakeId) return;

    const incomingVersion = resolveProtocolVersion(payload.protocolVersion);
    if (incomingVersion !== PROTOCOL_VERSION) {
      const providerErrors = this.#getProviderErrors();
      this.#handshakeId = null;
      this.#rejectHandshake(
        providerErrors.custom({
          code: 4900,
          message: `Unsupported protocol version: ${String(incomingVersion)}`,
        }),
      );
      return;
    }

    this.#applyHandshakePayload(payload, { emitConnect: true });
  };

  #handleResponseMessage = (id: string, payload: TransportResponse) => {
    const entry = this.#pendingRequests.get(id);
    if (!entry) return;
    this.#pendingRequests.delete(id);
    entry.resolve(payload);
  };

  #handleEventMessage = (payload: { event: string; params?: unknown[] }) => {
    const { event: eventName, params = [] } = payload;

    switch (eventName) {
      case "accountsChanged": {
        const [accounts] = params;
        if (Array.isArray(accounts)) {
          this.#updateAccounts(accounts);
        }
        break;
      }
      case "chainChanged": {
        const [update] = params;
        if (update && typeof update === "object" && typeof (update as { chainId?: unknown }).chainId === "string") {
          this.#updateChain(update as ChainUpdatePayload);
        }
        break;
      }
      case "session:locked": {
        this.#isUnlocked = false;
        this.#updateAccounts([]);
        this.emit("unlockStateChanged", { isUnlocked: false, payload: params[0] });
        break;
      }
      case "session:unlocked": {
        this.#isUnlocked = true;
        this.emit("unlockStateChanged", { isUnlocked: true, payload: params[0] });
        break;
      }
      case "disconnect":
        this.#handleDisconnect(params[0]);
        break;

      default:
        this.emit(eventName, ...params);
    }
  };

  #handleWindowMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!isEnvelope(data)) return;
    if (data.sessionId !== this.#sessionId) return;

    switch (data.type) {
      case "handshake_ack": {
        this.#handleHandshakeAckMessage(data.payload);
        break;
      }

      case "response": {
        this.#handleResponseMessage(data.id, data.payload);
        break;
      }

      case "event": {
        this.#handleEventMessage(data.payload);
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

  #sendHandshake() {
    const msg: Envelope = {
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "handshake",
      payload: { protocolVersion: PROTOCOL_VERSION, handshakeId: this.#handshakeId ?? createId() },
    };
    this.#handshakeId = msg.payload.handshakeId;
    window.postMessage(msg, window.location.origin);
  }
}
