import type { Unsubscribe } from "../../messenger/topic.js";
import { encodeWalletBridgeError } from "./errorEncoding.js";
import {
  WALLET_BRIDGE_PROTOCOL_VERSION,
  type WalletBridgeInvalidationEvent,
  type WalletBridgeReply,
  type WalletBridgeRequest,
  type WalletInvalidationTopic,
} from "./protocol.js";

export type WalletBridgeMethodExecutor = {
  executeUnknownPath(path: string, input: unknown): Promise<unknown>;
};

export type WalletInvalidationSource = {
  subscribeInvalidation(listener: (event: { topic: WalletInvalidationTopic }) => void): Unsubscribe;
};

export type WalletBridgeServer = {
  handleRequest(request: WalletBridgeRequest): Promise<WalletBridgeReply>;
  subscribeInvalidation(listener: (event: WalletBridgeInvalidationEvent) => void): Unsubscribe;
};

export const createWalletBridgeServer = (deps: {
  executor: WalletBridgeMethodExecutor;
  events?: WalletInvalidationSource;
}): WalletBridgeServer => {
  const createErrorReply = (id: string, error: unknown): WalletBridgeReply => ({
    type: "wallet:error",
    version: WALLET_BRIDGE_PROTOCOL_VERSION,
    id,
    error: encodeWalletBridgeError(error),
  });

  return {
    handleRequest: async (request) => {
      try {
        const result = await deps.executor.executeUnknownPath(request.path, request.input);
        return {
          type: "wallet:response",
          version: WALLET_BRIDGE_PROTOCOL_VERSION,
          id: request.id,
          result,
        };
      } catch (error) {
        return createErrorReply(request.id, error);
      }
    },
    subscribeInvalidation: (listener) => {
      if (!deps.events) {
        return () => {};
      }

      return deps.events.subscribeInvalidation((event) => {
        listener({
          type: "wallet:event",
          version: WALLET_BRIDGE_PROTOCOL_VERSION,
          event: "wallet:invalidation",
          topic: event.topic,
        });
      });
    },
  };
};
