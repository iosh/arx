import { getProviderErrors } from "@arx/core";
import { EventEmitter } from "@arx/provider-core";
import type {
  EIP1193ProviderRpcError,
  RequestArguments,
  Transport,
  TransportRequest,
  TransportResponse,
} from "@arx/provider-core/types";
import { CHANNEL } from "./constants.js";
import type { Envelope } from "./types.js";

type ConnectPayload = { chainId: string; caip2?: string; accounts: string[]; isUnlocked?: boolean };

export class InpageTransport extends EventEmitter implements Transport {
  #connected = false;
  #chainId: string | null = null;
  #caip2: string | null = null;
  #accounts: string[] = [];
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

  #getProviderErrors() {
    return getProviderErrors(this.#caip2 ?? undefined);
  }

  constructor() {
    super();

    window.addEventListener("message", this.#handleMessage);
  }

  #setConnection(payload: ConnectPayload) {
    const accounts = Array.isArray(payload.accounts)
      ? payload.accounts.filter((item): item is string => typeof item === "string")
      : [];
    this.#connected = true;
    this.#caip2 = payload.caip2 ?? null;
    this.#chainId = payload.chainId;
    this.#accounts = accounts;
    this.emit("connect", { chainId: payload.chainId, accounts });
  }

  #setAccounts(accounts: string[]) {
    const next = accounts.filter((item): item is string => typeof item === "string");
    this.#accounts = next;
    this.emit("accountsChanged", next);
  }

  #setChain(chainId: string) {
    this.#chainId = chainId;
    this.emit("chainChanged", chainId);
  }

  #handleDisconnect = () => {
    if (!this.#connected) {
      return;
    }
    const providerErrors = this.#getProviderErrors();
    this.#connected = false;
    this.#caip2 = null;
    this.#chainId = null;
    this.#accounts = [];
    const error = providerErrors.disconnected();

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
        if (!this.#connected) {
          this.#setConnection(data.payload);
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
            const [chainId] = params;
            if (typeof chainId === "string") {
              this.#setChain(chainId);
            }
            break;
          }
          case "disconnect":
            this.#handleDisconnect();
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
    window.removeEventListener("message", this.#handleMessage);
    this.#handleDisconnect();
  };
  destroy = () => {
    window.removeEventListener("message", this.#handleMessage);
    this.removeAllListeners();
  };
}
