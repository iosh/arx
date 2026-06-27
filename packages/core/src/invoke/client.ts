import { deserializeArxError } from "../error.js";
import type { Unsubscribe } from "../messenger/topic.js";
import {
  InvokeConnectInvalidatedError,
  InvokeProtocolError,
  InvokeTransportError,
  type InvokeTransportErrorReason,
} from "./errors.js";
import { type InvokeChannel, type InvokeEvent, type InvokeRequest, readInvokeMessage } from "./protocol.js";

export type InvokeConnectionStatus = "connected" | "disconnected";

export type InvokeReconnect = false | { getDelayMs(attempt: number): number };

type PendingInvoke = {
  target: string;
  action: string;
  resolve: (output: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type InvokeClient = Readonly<{
  connect(): Promise<void>;
  disconnect(): void;
  invoke<TResult>(target: string, action: string, input?: unknown): Promise<TResult>;
  subscribe(listener: (event: InvokeEvent) => void): Unsubscribe;
  onConnectionStatus(listener: (status: InvokeConnectionStatus) => void): Unsubscribe;
}>;

export type CreateInvokeClientOptions = {
  channel: InvokeChannel;
  createRequestId?: () => string;
  requestTimeoutMs?: number;
  reconnect?: InvokeReconnect;
};

const REQUEST_TIMEOUT_MS = 30_000;
const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

export const createInvokeClient = ({
  channel,
  createRequestId = defaultCreateRequestId,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  reconnect = false,
}: CreateInvokeClientOptions): InvokeClient => {
  const pending = new Map<string, PendingInvoke>();
  const eventListeners = new Set<(event: InvokeEvent) => void>();
  const connectionStatusListeners = new Set<(status: InvokeConnectionStatus) => void>();
  let connected = false;
  let connectPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let connectionVersion = 0;
  let lastDisconnectCause: unknown;

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const hasObservers = () => eventListeners.size > 0 || connectionStatusListeners.size > 0;

  const finishPending = (id: string, fn: (call: PendingInvoke) => void) => {
    const call = pending.get(id);
    if (!call) {
      return;
    }

    clearTimeout(call.timeout);
    pending.delete(id);
    fn(call);
  };

  const rejectPending = (reason: InvokeTransportErrorReason, cause?: unknown) => {
    for (const [id] of pending) {
      finishPending(id, (call) => {
        call.reject(
          new InvokeTransportError({
            target: call.target,
            action: call.action,
            requestId: id,
            reason,
            cause,
          }),
        );
      });
    }
  };

  const emitConnectionStatus = (status: InvokeConnectionStatus) => {
    for (const listener of connectionStatusListeners) {
      listener(status);
    }
  };

  const scheduleReconnect = () => {
    if (reconnect === false || reconnectTimer || connectPromise || connected || !hasObservers()) {
      return;
    }

    const attempt = reconnectAttempts;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch(() => {
        scheduleReconnect();
      });
    }, reconnect.getDelayMs(attempt));
  };

  const handleDisconnect = (error?: unknown) => {
    const wasConnected = connected;
    connectionVersion += 1;
    lastDisconnectCause = error;
    connected = false;
    connectPromise = null;
    clearReconnectTimer();
    rejectPending("disconnected", error);

    if (wasConnected) {
      emitConnectionStatus("disconnected");
    }

    scheduleReconnect();
  };

  const connect = async () => {
    if (connected) {
      return;
    }

    if (connectPromise) {
      return await connectPromise;
    }

    clearReconnectTimer();

    const connectVersion = connectionVersion;
    const pendingConnect = channel
      .connect()
      .then(() => {
        if (connectVersion !== connectionVersion) {
          throw new InvokeConnectInvalidatedError(lastDisconnectCause);
        }

        reconnectAttempts = 0;
        if (connected) {
          return;
        }

        connected = true;
        emitConnectionStatus("connected");
      })
      .catch((error) => {
        if (error instanceof InvokeTransportError) {
          throw error;
        }

        if (error instanceof InvokeConnectInvalidatedError) {
          throw new InvokeTransportError({
            target: "connection",
            action: "connect",
            requestId: "connect",
            reason: "disconnected",
            cause: error.cause,
          });
        }

        throw new InvokeTransportError({
          target: "connection",
          action: "connect",
          requestId: "connect",
          reason: "connect-failed",
          cause: error,
        });
      })
      .finally(() => {
        if (connectPromise === pendingConnect) {
          connectPromise = null;
        }
      });

    connectPromise = pendingConnect;
    return await pendingConnect;
  };

  channel.onMessage((raw) => {
    let message = null;

    try {
      message = readInvokeMessage(raw);
    } catch (error) {
      rejectPending("invalid-message", error);
      return;
    }

    if (!message || message.kind === "ready") {
      return;
    }

    if (message.kind === "event") {
      for (const listener of eventListeners) {
        listener(message);
      }
      return;
    }

    finishPending(message.id, (call) => {
      if (message.target !== call.target) {
        call.reject(
          new InvokeProtocolError({
            target: call.target,
            action: call.action,
            requestId: message.id,
            reason: `Reply target mismatch: ${message.target}.`,
          }),
        );
        return;
      }

      if (message.kind === "failure") {
        call.reject(deserializeArxError(message.error));
        return;
      }

      call.resolve(message.output);
    });
  });

  channel.onDisconnect?.((error) => {
    handleDisconnect(error);
  });

  const ensureObserverConnection = () => {
    void connect().catch(() => {
      scheduleReconnect();
    });
  };

  return {
    connect,
    disconnect: () => {
      handleDisconnect();
      channel.disconnect?.();
    },
    invoke: async <TResult>(target: string, action: string, input?: unknown): Promise<TResult> => {
      await connect();

      const id = createRequestId();
      const request: InvokeRequest = {
        kind: "invoke",
        target,
        id,
        action,
        ...(input !== undefined ? { input } : {}),
      };

      return await new Promise<TResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(
            new InvokeTransportError({
              target,
              action,
              requestId: id,
              reason: "request-timeout",
            }),
          );
        }, requestTimeoutMs);

        pending.set(id, {
          target,
          action,
          resolve: (output) => resolve(output as TResult),
          reject,
          timeout,
        });

        try {
          channel.postMessage(request);
        } catch (error) {
          finishPending(id, () => {
            reject(
              new InvokeTransportError({
                target,
                action,
                requestId: id,
                reason: "post-message-failed",
                cause: error,
              }),
            );
          });
        }
      });
    },
    subscribe: (listener) => {
      eventListeners.add(listener);
      ensureObserverConnection();
      return () => {
        eventListeners.delete(listener);
        if (!hasObservers()) {
          clearReconnectTimer();
        }
      };
    },
    onConnectionStatus: (listener) => {
      connectionStatusListeners.add(listener);
      ensureObserverConnection();
      return () => {
        connectionStatusListeners.delete(listener);
        if (!hasObservers()) {
          clearReconnectTimer();
        }
      };
    },
  };
};
