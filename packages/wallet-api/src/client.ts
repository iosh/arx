import type { WalletApi, WalletApiEvent } from "@arx/core/wallet";
import type { DuplexChannel } from "@arx/message-channel";
import { WalletApiError, WalletChannelDisconnectedError } from "./errors.js";
import { formatWalletMethodPath, parseWalletHostMessage, type WalletRequestMessage } from "./protocol.js";

export type WalletClient = WalletApi;

export type CreateWalletClientOptions = Readonly<{
  channel: DuplexChannel;
}>;

type PendingRequest = Readonly<{
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}>;

type WalletMethodCall = <TResult>(method: string, input?: unknown) => Promise<TResult>;

class WalletClientConnection {
  readonly #channel: DuplexChannel;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #eventListeners = new Set<(event: WalletApiEvent) => void>();
  #nextRequestId = 1;
  #disconnectedError: WalletChannelDisconnectedError | undefined;

  constructor(channel: DuplexChannel) {
    this.#channel = channel;
    channel.onMessage((raw) => this.#receive(raw));
    channel.onDisconnect(() => this.#disconnect());
  }

  call<TResult>(method: string, input?: unknown): Promise<TResult> {
    if (this.#disconnectedError) {
      return Promise.reject(this.#disconnectedError);
    }

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;

    return new Promise<TResult>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });

      const request: WalletRequestMessage = {
        type: "request",
        id,
        method,
        ...(input === undefined ? {} : { input }),
      };

      try {
        this.#channel.send(request);
      } catch (cause) {
        this.#pending.delete(id);
        reject(this.#disconnect(cause));
      }
    });
  }

  subscribe(listener: (event: WalletApiEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  #disconnect(cause?: unknown): WalletChannelDisconnectedError {
    if (this.#disconnectedError) {
      return this.#disconnectedError;
    }

    this.#disconnectedError = new WalletChannelDisconnectedError(cause);
    for (const request of this.#pending.values()) {
      request.reject(this.#disconnectedError);
    }
    this.#pending.clear();
    return this.#disconnectedError;
  }

  #receive(raw: unknown): void {
    const message = parseWalletHostMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "event") {
      this.#publishEvent(message.event);
      return;
    }

    const request = this.#pending.get(message.id);
    if (!request) {
      return;
    }

    this.#pending.delete(message.id);
    if (message.type === "failure") {
      request.reject(new WalletApiError(message.error));
      return;
    }

    request.resolve(message.result);
  }

  #publishEvent(event: WalletApiEvent): void {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // A UI listener cannot change settlement of a response or another listener.
      }
    }
  }
}

const createMethodProxy = (call: WalletMethodCall, path: readonly string[]): unknown => {
  const callable = (): undefined => undefined;

  return new Proxy(callable, {
    apply: (_target, _thisArg, args) => call(formatWalletMethodPath(path), args[0]),
    get: (_target, property) => {
      if (property === "then" || typeof property !== "string") {
        return undefined;
      }

      return createMethodProxy(call, [...path, property]);
    },
  });
};

const createWalletProxy = (connection: WalletClientConnection): WalletClient => {
  const localMethods = {
    subscribe: (listener: (event: WalletApiEvent) => void) => connection.subscribe(listener),
  };
  const call = connection.call.bind(connection);

  return new Proxy(localMethods, {
    get: (target, property) => {
      if (property === "then" || typeof property !== "string") {
        return undefined;
      }

      if (Object.hasOwn(target, property)) {
        return target[property as keyof typeof target];
      }

      return createMethodProxy(call, [property]);
    },
  }) as WalletClient;
};

export const createWalletClient = (options: CreateWalletClientOptions): WalletClient => {
  return createWalletProxy(new WalletClientConnection(options.channel));
};

export { WalletApiError, WalletChannelDisconnectedError } from "./errors.js";
