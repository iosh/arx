import { EventEmitter } from "@arx/provider-core";
import { evmProviderErrors } from "@arx/provider-core/errors";
import type {
  EIP1193ProviderRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  RequestArguments,
  Transport,
} from "@arx/provider-core/types";
import { CHANNEL } from "./constants.js";
import type { Envelope } from "./types.js";

type ConnectPayload = { chainId: string; accounts: string[]; isUnlocked?: boolean };

export class InpageTransport extends EventEmitter implements Transport {
  #connected = false;
  #chainId: string | null = null;
  #accounts: string[] = [];
  #timeoutMs = 120_000;
  #pendingRequests = new Map<
    string,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason?: EIP1193ProviderRpcError) => void;
      timer?: number;
    }
  >();

  #id = 0n;

  constructor() {
    super();

    window.addEventListener("message", this.#handleMessage);
  }

  #setConnection(payload: ConnectPayload) {
    this.#connected = true;
    this.#chainId = payload.chainId;
    this.#accounts = payload.accounts;
    this.emit("connect", payload);
  }

  #setAccounts(accounts: string[]) {
    this.#accounts = accounts;
    this.emit("accountsChanged", accounts);
  }

  #setChain(chainId: string) {
    this.#chainId = chainId;
    this.emit("chainChanged", chainId);
  }

  async request(args: RequestArguments): Promise<unknown> {
    if (!this.#connected) {
      throw evmProviderErrors.disconnected();
    }

    const { method, params = [] } = args;

    const request: JsonRpcRequest = {
      id: (this.#id++).toString(),
      jsonrpc: "2.0",
      method,
      params,
    };
    const id = request.id;
    const env: Envelope = { channel: CHANNEL, type: "request", id, payload: request };

    const rpc = await new Promise<JsonRpcResponse>((resolve, reject) => {
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

    const error = evmProviderErrors.disconnected();
    for (const [id, { reject }] of this.#pendingRequests) {
      reject(error);
      this.#pendingRequests.delete(id);
    }

    this.emit("disconnect", error);
  };

  destroy = () => {
    window.removeEventListener("message", this.#handleMessage);
    this.removeAllListeners();
  };
}
