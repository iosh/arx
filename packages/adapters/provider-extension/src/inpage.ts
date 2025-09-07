import type { EIP1193ProviderRpcError, JsonRpcRequest, JsonRpcResponse, Transport } from "@arx/provider-core/types";
import { EventEmitter } from "eventemitter3";
import { CHANNEL } from "./constants.js";
import type { Envelope } from "./types.js";

export class InpageTransport extends EventEmitter implements Transport {
  #connected = false;
  #timeoutMs = 120_000;
  #pendingRequests = new Map<
    string,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason?: EIP1193ProviderRpcError) => void;
      timer?: number;
    }
  >();

  constructor() {
    super();

    window.addEventListener("message", this.#handleMessage);
  }

  send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id;

    const env: Envelope = { channel: CHANNEL, type: "request", id, payload: request };

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
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
    });

    window.postMessage(env, "*");
    return promise;
  }

  #handleMessage = (event: MessageEvent) => {
    if (event.source !== window) return;

    const data = event.data as Envelope | undefined;

    if (!data || typeof data !== "object" || data?.channel !== CHANNEL) return;

    switch (data.type) {
      case "handshake_ack": {
        if (!this.#connected) {
          this.#connected = true;
          const chainId = data.payload?.chainId ?? "0x0";
          queueMicrotask(() => this.emit("connect", { chainId }));
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
        const { event, params = [] } = data.payload;
        this.emit(event, ...params);
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

  isConnected(): boolean {
    return this.#connected;
  }

  connect = async () => {
    const msg: Envelope = {
      channel: CHANNEL,
      type: "handshake",
      payload: { version: "2.0" },
    };
    window.postMessage(msg, "*");
  };

  disconnect = async () => {
    if (!this.#connected) {
      window.removeEventListener("message", this.#handleMessage);
      return;
    }
    this.#connected = false;
    window.removeEventListener("message", this.#handleMessage);

    const error: EIP1193ProviderRpcError = { code: 4900, message: "The Provider is disconnected from all chains." };

    for (const [id, { reject }] of this.#pendingRequests) {
      reject(error);
      this.#pendingRequests.delete(id);
    }

    this.emit("disconnect", error);
  };
}
