import { encodeWalletBridgeError } from "./errorEncoding.js";
import { WALLET_BRIDGE_PROTOCOL_VERSION, type WalletBridgeReply, type WalletBridgeRequest } from "./protocol.js";

export type WalletBridgeOperationExecutor = {
  executeUnknownPath(path: string, input: unknown): Promise<unknown>;
};

export type WalletBridgeServer = {
  handleRequest(request: WalletBridgeRequest): Promise<WalletBridgeReply>;
};

export const createWalletBridgeServer = (deps: { executor: WalletBridgeOperationExecutor }): WalletBridgeServer => {
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
  };
};
