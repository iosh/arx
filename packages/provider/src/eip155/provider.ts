import type { DuplexChannel } from "@arx/message-channel";
import * as z from "zod/mini";
import type { DappRequestParams, PageToWalletMessage, ProviderConnection } from "../protocol/messages.js";
import { parseWalletToPageMessage } from "../protocol/parse.js";
import {
  disconnectedProviderRequestError,
  invalidProviderRequestError,
  providerDisconnectEventError,
  toProviderRpcError,
} from "./errors.js";

const EIP155_NAMESPACE = "eip155";
const EIP155_CHAIN_REF_PATTERN = /^eip155:([1-9][0-9]*)$/;
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

const decodeEip155ChainId = (chainRef: string): string | null => {
  const reference = EIP155_CHAIN_REF_PATTERN.exec(chainRef)?.[1];
  if (!reference) {
    return null;
  }

  const chainId = Number(reference);
  if (!Number.isSafeInteger(chainId)) {
    return null;
  }

  return `0x${chainId.toString(16)}`;
};

class Eip155ProviderState implements Eip155Provider {
  readonly #channel: DuplexChannel;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #queuedRequestIds: number[] = [];
  readonly #listeners = new Map<string, Set<Eip1193Listener>>();
  #status: ProviderStatus = "connecting";
  #nextRequestId = 1;
  #chainId: string | null = null;
  #selectedAddress: string | null = null;

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
    return this.#selectedAddress;
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

    if (message.type === "disconnected") {
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

    if (message.type === "connection_changed") {
      this.#changeConnection(message.connection, message.changed);
      return;
    }

    const request = this.#pending.get(message.id);
    if (!request) {
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
    const chainId = decodeEip155ChainId(connection.chainRef);
    if (!chainId) {
      this.#disconnect(DISCONNECTED_MESSAGE);
      return;
    }

    const publishConnect = this.#status !== "connected";
    this.#status = "connected";
    this.#chainId = chainId;
    this.#selectedAddress = connection.accounts[0] ?? null;

    const queuedRequestIds = this.#queuedRequestIds.splice(0);
    for (const id of queuedRequestIds) {
      if (this.#status !== "connected") {
        return;
      }
      this.#sendRequest(id);
    }

    if (publishConnect && this.#status === "connected") {
      this.#publish("connect", { chainId });
    }
  }

  #changeConnection(connection: ProviderConnection, changed: Readonly<{ network: boolean; accounts: boolean }>): void {
    if (this.#status !== "connected") {
      return;
    }

    const chainId = decodeEip155ChainId(connection.chainRef);
    if (!chainId) {
      this.#disconnect(DISCONNECTED_MESSAGE);
      return;
    }

    const accounts = [...connection.accounts];
    this.#chainId = chainId;
    this.#selectedAddress = accounts[0] ?? null;

    if (changed.network) {
      this.#publish("chainChanged", chainId);
    }
    if (changed.accounts) {
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
    this.#selectedAddress = null;
    this.#queuedRequestIds.splice(0);

    const requestError = disconnectedProviderRequestError(message);
    for (const request of this.#pending.values()) {
      request.reject(requestError);
    }
    this.#pending.clear();

    this.#publish("disconnect", providerDisconnectEventError(message));
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
