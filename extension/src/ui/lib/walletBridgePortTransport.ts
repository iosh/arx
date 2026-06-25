import {
  isWalletBridgeEventMessage,
  isWalletBridgeReplyMessage,
  parseWalletBridgeEvent,
  parseWalletBridgeReply,
  type WalletBridgeClientTransport,
  type WalletBridgeEvent,
  type WalletBridgeReply,
  type WalletBridgeRequest,
  WalletBridgeTransportError,
  type WalletBridgeTransportErrorReason,
} from "@arx/core/wallet/bridge";
import type { BrowserPortChannel } from "./uiPortTransport";

type PendingWalletRequest = {
  request: WalletBridgeRequest;
  resolve: (reply: WalletBridgeReply) => void;
  reject: (reason: WalletBridgeTransportError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 200;
const RECONNECT_MAX_DELAY_MS = 5_000;

const calcReconnectDelayMs = (attempt: number) =>
  Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt);

const createTransportError = (
  request: WalletBridgeRequest,
  reason: WalletBridgeTransportErrorReason,
  cause?: unknown,
) =>
  new WalletBridgeTransportError({
    path: request.path,
    requestId: request.id,
    reason,
    cause,
  });

export const createWalletBridgePortTransport = (
  channel: BrowserPortChannel,
  options?: { requestTimeoutMs?: number; logger?: Pick<Console, "warn"> },
): WalletBridgeClientTransport => {
  const requestTimeoutMs = options?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const logger = options?.logger;
  const pending = new Map<string, PendingWalletRequest>();
  const eventListeners = new Set<(event: WalletBridgeEvent) => void>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;

  const finishPendingRequest = (id: string, fn: (request: PendingWalletRequest) => void) => {
    const request = pending.get(id);
    if (!request) return;

    clearTimeout(request.timeout);
    pending.delete(id);
    fn(request);
  };

  const rejectPendingRequests = (reason: WalletBridgeTransportErrorReason, cause?: unknown) => {
    for (const [id] of pending) {
      finishPendingRequest(id, (pendingRequest) => {
        pendingRequest.reject(createTransportError(pendingRequest.request, reason, cause));
      });
    }
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const connectEventStream = async () => {
    await channel.connect();
    reconnectAttempts = 0;
  };

  const scheduleReconnect = () => {
    if (eventListeners.size === 0) return;
    if (reconnectTimer) return;

    const attempt = reconnectAttempts;
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectEventStream().catch((error) => {
        logger?.warn("[walletBridge] event reconnect failed", error);
        scheduleReconnect();
      });
    }, calcReconnectDelayMs(attempt));
  };

  channel.onMessage((raw) => {
    if (isWalletBridgeEventMessage(raw)) {
      let event: WalletBridgeEvent;
      try {
        event = parseWalletBridgeEvent(raw);
      } catch (error) {
        logger?.warn("[walletBridge] invalid event", error);
        return;
      }

      for (const listener of eventListeners) {
        try {
          listener(event);
        } catch (error) {
          logger?.warn("[walletBridge] event listener threw", error);
        }
      }
      return;
    }

    if (!isWalletBridgeReplyMessage(raw)) return;

    let reply: WalletBridgeReply;
    try {
      reply = parseWalletBridgeReply(raw);
    } catch (error) {
      rejectPendingRequests("invalid-reply", error);
      logger?.warn("[walletBridge] invalid reply", error);
      return;
    }

    finishPendingRequest(reply.id, (request) => request.resolve(reply));
  });

  channel.onDisconnect?.((error) => {
    rejectPendingRequests("disconnected", error);
    scheduleReconnect();
  });

  return {
    subscribe: (listener) => {
      eventListeners.add(listener);
      void connectEventStream().catch((error) => {
        logger?.warn("[walletBridge] event subscribe connect failed", error);
        scheduleReconnect();
      });

      return () => {
        eventListeners.delete(listener);
        if (eventListeners.size === 0) {
          clearReconnectTimer();
        }
      };
    },

    request: async (request) => {
      try {
        await channel.connect();
      } catch (error) {
        throw createTransportError(request, "connect-failed", error);
      }

      return await new Promise<WalletBridgeReply>((resolve, reject) => {
        const timeout = setTimeout(() => {
          finishPendingRequest(request.id, (pendingRequest) => {
            pendingRequest.reject(createTransportError(pendingRequest.request, "request-timeout"));
          });
        }, requestTimeoutMs);

        pending.set(request.id, { request, resolve, reject, timeout });

        try {
          channel.postMessage(request);
        } catch (error) {
          finishPendingRequest(request.id, (pendingRequest) => {
            pendingRequest.reject(createTransportError(pendingRequest.request, "post-message-failed", error));
          });
        }
      });
    },
  };
};
