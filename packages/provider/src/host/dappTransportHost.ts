import { isArxBaseError } from "@arx/core";
import {
  RpcChainUnavailableError,
  RpcInternalError,
  RpcInvalidParamsError,
  RpcInvalidRequestError,
  RpcJsonRpcResponseError,
  RpcOutcomeUnknownError,
  RpcUnauthorizedError,
  RpcUnrecognizedChainError,
  RpcUnsupportedMethodError,
  RpcUserRejectedRequestError,
} from "@arx/core/rpc";
import type { CoreRuntime } from "@arx/core/runtime";
import type { DuplexChannel } from "@arx/message-channel";
import type {
  DappErrorKind,
  PageToWalletMessage,
  ProviderConnection,
  SerializedDappError,
  WalletToPageMessage,
} from "../protocol/messages.js";
import { parsePageToWalletMessage } from "../protocol/parse.js";

type DappConnectionsApi = CoreRuntime["dappConnections"];
type DappConnectionScope = Parameters<DappConnectionsApi["openConnection"]>[0];
type DappConnectionState = ReturnType<DappConnectionsApi["getConnectionState"]>;
type DappConnectionStateChanged = Parameters<Parameters<DappConnectionsApi["subscribeStateChanged"]>[0]>[0];

type AttachedChannel = Readonly<{
  origin: string;
  namespaces: Set<string>;
  unsubscribeMessage: () => void;
  unsubscribeDisconnect: () => void;
}>;

type OpenScope = Readonly<{
  scope: DappConnectionScope;
  channels: Set<DuplexChannel>;
}>;

export type DappTransportHost = Readonly<{
  attach(input: Readonly<{ channel: DuplexChannel; origin: string }>): void;
}>;

export type CreateDappTransportHostOptions = Readonly<{
  dappConnections: DappConnectionsApi;
}>;

const INTERNAL_ERROR: SerializedDappError = {
  kind: "internal",
  message: "Internal error.",
};

const DISCONNECTED_ERROR = {
  kind: "disconnected",
  message: "The provider is disconnected.",
} as const satisfies SerializedDappError;

const DAPP_ERROR_KINDS_BY_CORE_CODE: Readonly<Record<string, Exclude<DappErrorKind, "json_rpc_response">>> = {
  [RpcInvalidRequestError.code]: "invalid_request",
  [RpcInvalidParamsError.code]: "invalid_params",
  [RpcUserRejectedRequestError.code]: "user_rejected",
  [RpcUnauthorizedError.code]: "unauthorized",
  [RpcUnsupportedMethodError.code]: "unsupported_method",
  [RpcUnrecognizedChainError.code]: "unrecognized_chain",
  [RpcChainUnavailableError.code]: "chain_unavailable",
  [RpcOutcomeUnknownError.code]: "outcome_unknown",
};

const scopeKey = (scope: DappConnectionScope): string => JSON.stringify([scope.origin, scope.namespace]);

const toProviderConnection = (state: DappConnectionState): ProviderConnection => ({
  chainRef: state.chainRef,
  accounts: state.accounts,
});

const serializeDappError = (error: unknown): SerializedDappError => {
  if (!isArxBaseError(error)) {
    return INTERNAL_ERROR;
  }

  if (error.code === RpcJsonRpcResponseError.code) {
    const jsonRpcError = error as RpcJsonRpcResponseError;
    return {
      kind: "json_rpc_response",
      message: jsonRpcError.message,
      data: {
        code: jsonRpcError.rpcCode,
        ...(jsonRpcError.rpcData === undefined ? {} : { data: jsonRpcError.rpcData }),
      },
    };
  }

  if (error.code === RpcInternalError.code) return INTERNAL_ERROR;

  const kind = DAPP_ERROR_KINDS_BY_CORE_CODE[error.code];
  if (!kind) {
    return INTERNAL_ERROR;
  }

  return { kind, message: error.message };
};

class DappTransportHostState implements DappTransportHost {
  readonly #dappConnections: DappConnectionsApi;
  readonly #channels = new Map<DuplexChannel, AttachedChannel>();
  readonly #openScopes = new Map<string, OpenScope>();

  constructor(dappConnections: DappConnectionsApi) {
    this.#dappConnections = dappConnections;
    dappConnections.subscribeStateChanged((change) => this.#publishConnectionChange(change));
  }

  attach({ channel, origin }: Readonly<{ channel: DuplexChannel; origin: string }>): void {
    if (this.#channels.has(channel)) {
      return;
    }

    const unsubscribeMessage = channel.onMessage((raw) => this.#receive(channel, raw));
    const unsubscribeDisconnect = channel.onDisconnect(() => this.#detach(channel));

    this.#channels.set(channel, {
      origin,
      namespaces: new Set(),
      unsubscribeMessage,
      unsubscribeDisconnect,
    });
  }

  #receive(channel: DuplexChannel, raw: unknown): void {
    const message = parsePageToWalletMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "open") {
      this.#open(channel, message.namespace);
      return;
    }

    void this.#request(channel, message);
  }

  #open(channel: DuplexChannel, namespace: string): void {
    const attached = this.#channels.get(channel);
    if (!attached) {
      return;
    }

    const scope = { origin: attached.origin, namespace };
    const key = scopeKey(scope);
    let openScope = this.#openScopes.get(key);

    try {
      const connection = openScope
        ? this.#dappConnections.getConnectionState(scope)
        : this.#dappConnections.openConnection(scope);

      if (!attached.namespaces.has(namespace)) {
        if (!openScope) {
          openScope = { scope, channels: new Set() };
          this.#openScopes.set(key, openScope);
        }

        attached.namespaces.add(namespace);
        openScope.channels.add(channel);
      }

      this.#send(
        channel,
        {
          type: "opened",
          namespace,
          connection: toProviderConnection(connection),
        },
        attached,
      );
    } catch (error) {
      this.#closeNamespace(channel, attached, namespace);
      this.#send(
        channel,
        {
          type: "open_failed",
          namespace,
          error: serializeDappError(error),
        },
        attached,
      );
    }
  }

  async #request(channel: DuplexChannel, message: Extract<PageToWalletMessage, { type: "request" }>): Promise<void> {
    const attached = this.#channels.get(channel);
    if (!attached) {
      return;
    }

    if (!attached.namespaces.has(message.namespace)) {
      this.#send(
        channel,
        {
          type: "failure",
          namespace: message.namespace,
          id: message.id,
          error: DISCONNECTED_ERROR,
        },
        attached,
      );
      return;
    }

    const scope = { origin: attached.origin, namespace: message.namespace };

    try {
      const result = await this.#dappConnections.request({
        scope,
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params }),
      });

      this.#send(
        channel,
        {
          type: "success",
          namespace: message.namespace,
          id: message.id,
          result,
        },
        attached,
      );
    } catch (error) {
      this.#send(
        channel,
        {
          type: "failure",
          namespace: message.namespace,
          id: message.id,
          error: serializeDappError(error),
        },
        attached,
      );
    }
  }

  #publishConnectionChange(change: DappConnectionStateChanged): void {
    const openScope = this.#openScopes.get(scopeKey(change.scope));
    if (!openScope) {
      return;
    }

    const message: WalletToPageMessage = {
      type: "connection_changed",
      namespace: change.scope.namespace,
      connection: toProviderConnection(change.state),
    };

    for (const channel of [...openScope.channels]) {
      const attached = this.#channels.get(channel);
      if (attached) {
        this.#send(channel, message, attached);
      }
    }
  }

  #send(channel: DuplexChannel, message: WalletToPageMessage, attached: AttachedChannel): void {
    if (this.#channels.get(channel) !== attached) {
      return;
    }

    try {
      channel.send(message);
    } catch {
      this.#detach(channel, attached);
    }
  }

  #detach(channel: DuplexChannel, expected?: AttachedChannel): void {
    const attached = this.#channels.get(channel);
    if (!attached || (expected && attached !== expected)) {
      return;
    }

    this.#channels.delete(channel);
    attached.unsubscribeMessage();
    attached.unsubscribeDisconnect();

    for (const namespace of [...attached.namespaces]) {
      this.#closeNamespace(channel, attached, namespace);
    }
  }

  #closeNamespace(channel: DuplexChannel, attached: AttachedChannel, namespace: string): void {
    if (!attached.namespaces.delete(namespace)) return;

    const key = scopeKey({ origin: attached.origin, namespace });
    const openScope = this.#openScopes.get(key);
    if (!openScope) return;

    openScope.channels.delete(channel);
    if (openScope.channels.size > 0) return;

    this.#openScopes.delete(key);
    this.#dappConnections.closeConnection(openScope.scope);
  }
}

export const createDappTransportHost = ({ dappConnections }: CreateDappTransportHostOptions): DappTransportHost => {
  return new DappTransportHostState(dappConnections);
};
