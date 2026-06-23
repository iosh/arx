import {
  isWalletBridgeReplyMessage,
  parseWalletBridgeReply,
  type WalletBridgeClientTransport,
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

  channel.onMessage((raw) => {
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
  });

  return {
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
