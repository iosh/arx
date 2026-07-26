import { isArxBaseError } from "@arx/core";
import type { WalletApi, WalletApiEvent } from "@arx/core/wallet";
import type { DuplexChannel } from "@arx/message-channel";
import type { SerializedWalletApiError } from "./errors.js";
import {
  formatWalletMethodPath,
  parseWalletRequest,
  type WalletHostMessage,
  type WalletRequestMessage,
} from "./protocol.js";

const METHOD_NOT_FOUND_CODE = "wallet_api.method_not_found";
const INTERNAL_ERROR_CODE = "wallet_api.internal_error";
const INTERNAL_ERROR_MESSAGE = "Wallet operation failed.";

type WalletMethod = (input?: unknown) => unknown | Promise<unknown>;
type RemoteWalletApi = Omit<WalletApi, "subscribe">;

type ChannelRegistration = Readonly<{
  unsubscribeMessage: () => void;
  unsubscribeDisconnect: () => void;
}>;

export type WalletHost = Readonly<{
  attach(channel: DuplexChannel): void;
}>;

export type CreateWalletHostOptions = Readonly<{
  api: WalletApi;
}>;

const createWalletMethodTable = (api: RemoteWalletApi): ReadonlyMap<string, WalletMethod> => {
  const methods = new Map<string, WalletMethod>();

  const visit = (node: object, path: readonly string[]): void => {
    for (const [name, value] of Object.entries(node)) {
      const methodPath = [...path, name];
      if (typeof value === "function") {
        methods.set(formatWalletMethodPath(methodPath), value as WalletMethod);
        continue;
      }

      visit(value as object, methodPath);
    }
  };

  visit(api, []);
  return methods;
};

const serializeError = (error: unknown): SerializedWalletApiError => {
  if (isArxBaseError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  return { code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE };
};

const methodNotFound = (method: string): SerializedWalletApiError => ({
  code: METHOD_NOT_FOUND_CODE,
  message: `Unknown wallet method: ${method}.`,
});

class WalletHostState implements WalletHost {
  readonly #methods: ReadonlyMap<string, WalletMethod>;
  readonly #channels = new Map<DuplexChannel, ChannelRegistration>();

  constructor(api: WalletApi) {
    const { subscribe, ...remoteApi } = api;
    this.#methods = createWalletMethodTable(remoteApi);
    subscribe((event) => this.#broadcast(event));
  }

  attach(channel: DuplexChannel): void {
    if (this.#channels.has(channel)) {
      return;
    }

    const unsubscribeMessage = channel.onMessage((raw) => {
      const request = parseWalletRequest(raw);
      if (request) {
        void this.#dispatch(channel, request);
      }
    });
    const unsubscribeDisconnect = channel.onDisconnect(() => {
      this.#detach(channel);
    });

    this.#channels.set(channel, { unsubscribeMessage, unsubscribeDisconnect });
  }

  #detach(channel: DuplexChannel): void {
    const registration = this.#channels.get(channel);
    if (!registration) {
      return;
    }

    this.#channels.delete(channel);
    registration.unsubscribeMessage();
    registration.unsubscribeDisconnect();
  }

  #send(channel: DuplexChannel, message: WalletHostMessage): void {
    if (!this.#channels.has(channel)) {
      return;
    }

    try {
      channel.send(message);
    } catch {
      this.#detach(channel);
    }
  }

  async #dispatch(channel: DuplexChannel, request: WalletRequestMessage): Promise<void> {
    const method = this.#methods.get(request.method);
    if (!method) {
      this.#send(channel, { type: "failure", id: request.id, error: methodNotFound(request.method) });
      return;
    }

    try {
      const result = await method(request.input);
      this.#send(channel, {
        type: "success",
        id: request.id,
        ...(result === undefined ? {} : { result }),
      });
    } catch (error) {
      this.#send(channel, { type: "failure", id: request.id, error: serializeError(error) });
    }
  }

  #broadcast(event: WalletApiEvent): void {
    for (const channel of [...this.#channels.keys()]) {
      this.#send(channel, { type: "event", event });
    }
  }
}

export const createWalletHost = (options: CreateWalletHostOptions): WalletHost => {
  return new WalletHostState(options.api);
};
