import { EventEmitter } from "eventemitter3";
import { CHANNEL } from "../protocol/channel.js";
import { deriveProtocolVersion, type Envelope, type HandshakeAckPayload, isEnvelope } from "../protocol/envelope.js";
import type { ProviderRpcRequest, ProviderRpcResponse } from "../protocol/rpc.js";
import { PROTOCOL_VERSION } from "../protocol/version.js";
import type { RequestArguments } from "../types/eip1193.js";
import type { Transport, TransportRequestOptions } from "../types/transport.js";
import type { TransportCodec } from "./codec.js";
import { transportFailures } from "./transportFailure.js";

export type WindowPostMessageTransportOptions<TSnapshot = unknown, TPatch = unknown> = {
  namespace: string;
  handshakeTimeoutMs?: number;
  codec: TransportCodec<TSnapshot, TPatch>;
};

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8000;

const isHandshakeAckPayload = (value: unknown): value is HandshakeAckPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HandshakeAckPayload>;
  if (typeof candidate.handshakeId !== "string") return false;
  return Object.hasOwn(candidate, "state");
};

const createId = (): string => {
  return globalThis.crypto.randomUUID();
};

export class WindowPostMessageTransport<TSnapshot = unknown, TPatch = unknown>
  extends EventEmitter
  implements Transport<TSnapshot, TPatch>
{
  #codec: TransportCodec<TSnapshot, TPatch>;
  #namespace: string;
  #connected = false;
  #requestTimeoutMs = 120_000;
  #handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS;
  #handshakeId: string | null = null;
  #sessionId: string;
  #bootstrapSnapshot: TSnapshot | null = null;
  #bootstrapPatches: TPatch[] = [];
  #pendingRequests = new Map<
    string,
    {
      resolve: (value: ProviderRpcResponse) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  #id = 0n;

  #bootstrapPromise: Promise<TSnapshot> | null = null;
  #bootstrapResolve?: ((value: TSnapshot) => void) | undefined;
  #bootstrapReject?: ((reason?: unknown) => void) | undefined;
  #handshakeTimeoutId: number | undefined;

  constructor(options: WindowPostMessageTransportOptions<TSnapshot, TPatch>) {
    super();

    const { codec, handshakeTimeoutMs, namespace } = options;
    this.#codec = codec;
    if (typeof handshakeTimeoutMs === "number") {
      this.#handshakeTimeoutMs = handshakeTimeoutMs;
    }
    this.#namespace = namespace;

    this.#sessionId = createId();
    window.addEventListener("message", this.#handleWindowMessage);
  }

  async bootstrap(): Promise<TSnapshot> {
    if (this.#connected && this.#bootstrapSnapshot) {
      return this.#codec.cloneSnapshot(this.#bootstrapSnapshot);
    }

    if (this.#bootstrapPromise) {
      return this.#bootstrapPromise.then((snapshot) => this.#codec.cloneSnapshot(snapshot));
    }

    this.#sessionId = createId();
    this.#handshakeId = createId();
    this.#bootstrapPatches = [];
    this.#bootstrapPromise = new Promise<TSnapshot>((resolve, reject) => {
      this.#bootstrapResolve = resolve;
      this.#bootstrapReject = reject;
    });
    void this.#bootstrapPromise.catch(() => {});

    this.#handshakeTimeoutId = window.setTimeout(() => {
      this.#handshakeId = null;
      this.#rejectBootstrap(transportFailures.handshakeTimeout());
    }, this.#handshakeTimeoutMs);

    this.#sendHandshake();
    return this.#bootstrapPromise.then((snapshot) => this.#codec.cloneSnapshot(snapshot));
  }

  isConnected(): boolean {
    return this.#connected;
  }

  async request(args: RequestArguments, options?: TransportRequestOptions): Promise<unknown> {
    if (!this.#connected) {
      throw transportFailures.disconnected();
    }

    const { method, params } = args;

    const request: ProviderRpcRequest = {
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

    const rpc = await new Promise<ProviderRpcResponse>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.#requestTimeoutMs;
      const timeoutId = window.setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(transportFailures.requestTimeout());
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

  disconnect = async () => {
    this.#handleDisconnect();
  };

  destroy = () => {
    this.#handleDisconnect();
    window.removeEventListener("message", this.#handleWindowMessage);
    this.removeAllListeners();
  };

  #applyHandshakePayload(snapshot: TSnapshot) {
    let resolvedSnapshot = snapshot;
    for (const patch of this.#bootstrapPatches) {
      resolvedSnapshot = this.#codec.applyPatch(resolvedSnapshot, patch);
    }

    this.#connected = true;
    this.#bootstrapSnapshot = resolvedSnapshot;
    this.#bootstrapPatches = [];
    this.#completeBootstrap(resolvedSnapshot);
  }

  #emitPatch(patch: TPatch) {
    this.emit("patch", this.#codec.clonePatch(patch));
  }

  #clearHandshakeTimeout() {
    if (this.#handshakeTimeoutId === undefined) return;
    window.clearTimeout(this.#handshakeTimeoutId);
    this.#handshakeTimeoutId = undefined;
  }

  #completeBootstrap(snapshot: TSnapshot) {
    if (!this.#bootstrapPromise) return;

    this.#clearHandshakeTimeout();
    this.#bootstrapResolve?.(this.#codec.cloneSnapshot(snapshot));
    this.#bootstrapPromise = null;
    this.#bootstrapResolve = undefined;
    this.#bootstrapReject = undefined;
  }

  #rejectBootstrap(error?: unknown) {
    if (!this.#bootstrapPromise) return;

    void this.#bootstrapPromise.catch(() => {});

    this.#clearHandshakeTimeout();
    this.#bootstrapPatches = [];
    this.#bootstrapReject?.(error);
    this.#bootstrapPromise = null;
    this.#bootstrapResolve = undefined;
    this.#bootstrapReject = undefined;
  }

  #handleDisconnect = (reason?: unknown) => {
    if (!this.#connected && !this.#bootstrapPromise) {
      return;
    }
    const error =
      reason && typeof reason === "object" && "code" in (reason as Record<string, unknown>)
        ? reason
        : transportFailures.disconnected();

    this.#connected = false;
    this.#bootstrapSnapshot = null;
    this.#bootstrapPatches = [];
    this.#handshakeId = null;
    this.#sessionId = createId();

    this.#rejectBootstrap(error);
    for (const [id, { reject }] of this.#pendingRequests) {
      reject(error);
      this.#pendingRequests.delete(id);
    }
    this.emit("disconnect", error);
  };

  #handleHandshakeAckMessage = (payload: unknown) => {
    if (!this.#bootstrapPromise) return;
    if (!this.#handshakeId) return;
    if (!isHandshakeAckPayload(payload)) return;
    if (payload.handshakeId !== this.#handshakeId) return;

    const incomingVersion = deriveProtocolVersion(payload.protocolVersion);
    if (incomingVersion !== PROTOCOL_VERSION) {
      this.#handshakeId = null;
      this.#rejectBootstrap(transportFailures.protocolVersionMismatch(incomingVersion));
      return;
    }

    const snapshot = this.#codec.parseHandshakeState(payload.state);
    if (!snapshot) {
      return;
    }

    this.#applyHandshakePayload(snapshot);
  };

  #handleResponseMessage = (id: string, payload: ProviderRpcResponse) => {
    const entry = this.#pendingRequests.get(id);
    if (!entry) return;
    this.#pendingRequests.delete(id);
    entry.resolve(payload);
  };

  #handleEventMessage = (payload: Extract<Envelope, { type: "event" }>["payload"]) => {
    const result = this.#codec.parseEvent(payload);

    switch (result.kind) {
      case "patches":
        if (!this.#bootstrapSnapshot) {
          if (this.#bootstrapPromise) {
            for (const patch of result.patches) {
              this.#bootstrapPatches.push(this.#codec.clonePatch(patch));
            }
          }
          return;
        }
        for (const patch of result.patches) {
          this.#bootstrapSnapshot = this.#codec.applyPatch(this.#bootstrapSnapshot, patch);
          this.#emitPatch(patch);
        }
        return;

      case "disconnect":
        this.#handleDisconnect(result.error);
        return;

      case "ignore":
        return;
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
        break;

      default:
        break;
    }
  };

  #sendHandshake() {
    const msg: Envelope = {
      channel: CHANNEL,
      sessionId: this.#sessionId,
      type: "handshake",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        handshakeId: this.#handshakeId ?? createId(),
        namespace: this.#namespace,
      },
    };
    this.#handshakeId = msg.payload.handshakeId;
    window.postMessage(msg, window.location.origin);
  }
}
