import { chainIdFromChainRef } from "@arx/core/namespaces";
import type { DuplexChannel } from "@arx/message-channel";
import * as z from "zod/mini";
import type { DappRequestParams, PageToWalletMessage, ProviderConnection } from "../protocol/messages.js";
import { parseWalletToPageMessage } from "../protocol/parse.js";
import { disconnectedProviderRequestError, invalidProviderRequestError, toProviderRpcError } from "./errors.js";

const EIP155_NAMESPACE = "eip155";
const DISCONNECTED_MESSAGE = "The provider is disconnected.";

export type Eip1193RequestArguments = Readonly<{
  method: string;
  params?: readonly unknown[] | object;
}>;

export type Eip1193Listener = (...args: unknown[]) => void;

export type Eip155Provider = Readonly<{
  request<TResult = unknown>(input: Eip1193RequestArguments): Promise<TResult>;
  isConnected(): boolean;
  on(event: string, listener: Eip1193Listener): Eip155Provider;
  removeListener(event: string, listener: Eip1193Listener): Eip155Provider;
  readonly chainId: string | null;
  readonly selectedAddress: string | null;
}>;

export type CreateEip155ProviderOptions = Readonly<{
  channel: DuplexChannel;
}>;

type ProviderStatus = "connecting" | "connected" | "disconnected";
type ProviderRequestMessage = Extract<PageToWalletMessage, { type: "request" }>;

type PendingRequest = Readonly<{
  message: ProviderRequestMessage;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}>;

type ParsedRequestArguments = Readonly<{
  method: string;
  params?: DappRequestParams;
}>;

const REQUEST_ARGUMENTS_SCHEMA = z.pipe(
  z.object({
    method: z.string().check(z.minLength(1)),
    params: z.optional(z.union([z.array(z.json()), z.record(z.string(), z.json())])),
  }),
  z.transform(({ method, params }) => (params === undefined ? { method } : { method, params })),
);

const parseRequestArguments = (input: unknown): ParsedRequestArguments | null => {
  try {
    const parsed = z.safeParse(REQUEST_ARGUMENTS_SCHEMA, input);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const eip1193ChainIdFromChainRef = (chainRef: string): string => `0x${chainIdFromChainRef(chainRef).toString(16)}`;

const accountsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((account, index) => account === right[index]);

class Eip155ProviderState implements Eip155Provider {
  readonly #channel: DuplexChannel;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #queuedRequestIds: number[] = [];
  readonly #listeners = new Map<string, Set<Eip1193Listener>>();
  #status: ProviderStatus = "connecting";
  #nextRequestId = 1;
  #chainId: string | null = null;
  #accounts: readonly string[] = [];

  constructor(channel: DuplexChannel) {
    this.#channel = channel;
    channel.onMessage((raw) => this.#receive(raw));
    channel.onDisconnect(() => this.#disconnect(DISCONNECTED_MESSAGE));

    try {
      channel.send({ type: "open", namespace: EIP155_NAMESPACE } satisfies PageToWalletMessage);
    } catch {
      this.#disconnect(DISCONNECTED_MESSAGE);
    }
  }

  get chainId(): string | null {
    return this.#chainId;
  }

  get selectedAddress(): string | null {
    return this.#accounts[0] ?? null;
  }

  readonly request = <TResult = unknown>(input: Eip1193RequestArguments): Promise<TResult> => {
    const request = parseRequestArguments(input);
    if (!request) {
      return Promise.reject(invalidProviderRequestError());
    }

    if (this.#status === "disconnected") {
      return Promise.reject(disconnectedProviderRequestError());
    }

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;

    const message: ProviderRequestMessage = {
      type: "request",
      namespace: EIP155_NAMESPACE,
      id,
      method: request.method,
      ...(request.params === undefined ? {} : { params: request.params }),
    };

    return new Promise<TResult>((resolve, reject) => {
      this.#pending.set(id, {
        message,
        resolve: (value) => resolve(value as TResult),
        reject,
      });

      if (this.#status === "connecting") {
        this.#queuedRequestIds.push(id);
        return;
      }

      this.#sendRequest(id);
    });
  };

  readonly isConnected = (): boolean => this.#status === "connected";

  readonly on = (event: string, listener: Eip1193Listener): Eip155Provider => {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }

    listeners.add(listener);
    return this;
  };

  readonly removeListener = (event: string, listener: Eip1193Listener): Eip155Provider => {
    const listeners = this.#listeners.get(event);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.#listeners.delete(event);
    }

    return this;
  };

  #receive(raw: unknown): void {
    const message = parseWalletToPageMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "transport_disconnected") {
      this.#disconnect(message.error.message);
      return;
    }

    if (message.namespace !== EIP155_NAMESPACE) {
      return;
    }

    if (message.type === "opened") {
      this.#open(message.connection);
      return;
    }

    if (message.type === "open_failed") {
      this.#disconnect(message.error.message);
      return;
    }

    if (message.type === "connection_changed") {
      this.#changeConnection(message.connection);
      return;
    }

    const request = this.#pending.get(message.id);
    if (!request) {
      return;
    }

    if (message.type === "failure" && message.error.kind === "disconnected") {
      this.#disconnect(message.error.message);
      return;
    }

    this.#pending.delete(message.id);
    if (message.type === "failure") {
      request.reject(toProviderRpcError(message.error));
      return;
    }

    request.resolve(message.result);
  }

  #open(connection: ProviderConnection): void {
    if (this.#status === "connected") {
      this.#changeConnection(connection);
      return;
    }

    const chainId = eip1193ChainIdFromChainRef(connection.chainRef);
    const accounts = [...connection.accounts];
    this.#status = "connected";
    this.#chainId = chainId;
    this.#accounts = accounts;

    this.#publish("connect", { chainId });
    if (this.#status !== "connected") return;

    const queuedRequestIds = this.#queuedRequestIds.splice(0);
    for (const id of queuedRequestIds) {
      if (this.#status !== "connected") return;
      this.#sendRequest(id);
    }
  }

  #changeConnection(connection: ProviderConnection): void {
    if (this.#status !== "connected") {
      return;
    }

    const chainId = eip1193ChainIdFromChainRef(connection.chainRef);
    const accounts = [...connection.accounts];
    const chainChanged = this.#chainId !== chainId;
    const accountsChanged = !accountsEqual(this.#accounts, accounts);
    if (!chainChanged && !accountsChanged) return;

    this.#chainId = chainId;
    this.#accounts = accounts;

    if (chainChanged) {
      this.#publish("chainChanged", chainId);
      if (this.#status !== "connected") return;
    }
    if (accountsChanged) {
      this.#publish("accountsChanged", accounts);
    }
  }

  #sendRequest(id: number): void {
    const request = this.#pending.get(id);
    if (!request) {
      return;
    }

    try {
      this.#channel.send(request.message);
    } catch {
      this.#disconnect(DISCONNECTED_MESSAGE);
    }
  }

  #disconnect(message: string): void {
    if (this.#status === "disconnected") {
      return;
    }

    this.#status = "disconnected";
    this.#chainId = null;
    this.#accounts = [];
    this.#queuedRequestIds.splice(0);

    const disconnectError = disconnectedProviderRequestError(message);
    for (const request of this.#pending.values()) {
      request.reject(disconnectError);
    }
    this.#pending.clear();

    this.#publish("disconnect", disconnectError);
  }

  #publish(event: string, value: unknown): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) {
      return;
    }

    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch {
        // A page listener cannot prevent state updates or another listener.
      }
    }
  }
}

export const createEip155Provider = (options: CreateEip155ProviderOptions): Eip155Provider => {
  return new Eip155ProviderState(options.channel);
};
