import { ArxBaseError, type ErrorCause, type SerializedArxError } from "../../error.js";
import { createWalletOperationClient, type WalletOperationClient } from "../operationClient.js";
import { walletOperations } from "../operations.js";
import { WALLET_BRIDGE_PROTOCOL_VERSION, type WalletBridgeReply, type WalletBridgeRequest } from "./protocol.js";

export type WalletBridgeClientTransport = {
  request(request: WalletBridgeRequest): Promise<WalletBridgeReply>;
};

export type RemoteTrustedWalletClientOptions = {
  createRequestId?: () => string;
};

export type RemoteTrustedWalletClient = WalletOperationClient<typeof walletOperations>;

export class WalletBridgeRemoteError extends ArxBaseError {
  static readonly code = "wallet.bridge.remote";

  remoteName: SerializedArxError["name"];
  remoteCode: SerializedArxError["code"];

  constructor(error: SerializedArxError) {
    super(`Remote wallet bridge error: ${error.message}`, {
      code: WalletBridgeRemoteError.code,
      details: {
        remoteName: error.name,
        remoteCode: error.code,
        ...(error.details !== undefined ? { remoteDetails: error.details } : {}),
      },
    });
    this.remoteName = error.name;
    this.remoteCode = error.code;
  }
}

export class WalletBridgeProtocolError extends ArxBaseError {
  static readonly code = "wallet.bridge.protocol";

  constructor(input: ErrorCause & { path: string; reason: string }) {
    super(`Wallet bridge protocol error for "${input.path}": ${input.reason}`, {
      code: WalletBridgeProtocolError.code,
      details: {
        path: input.path,
        reason: input.reason,
      },
      cause: input.cause,
    });
  }
}

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

const sendRemoteWalletOperation = async (deps: {
  path: string;
  input: unknown;
  transport: WalletBridgeClientTransport;
  createRequestId: () => string;
}): Promise<unknown> => {
  const request: WalletBridgeRequest = {
    type: "wallet:request",
    version: WALLET_BRIDGE_PROTOCOL_VERSION,
    id: deps.createRequestId(),
    path: deps.path,
    ...(deps.input !== undefined ? { input: deps.input } : {}),
  };

  const reply = await deps.transport.request(request);

  if (reply.version !== WALLET_BRIDGE_PROTOCOL_VERSION) {
    throw new WalletBridgeProtocolError({
      path: deps.path,
      reason: `Reply protocol version mismatch: ${reply.version}.`,
    });
  }

  if (reply.id !== request.id) {
    throw new WalletBridgeProtocolError({
      path: deps.path,
      reason: `Reply id mismatch: ${reply.id}.`,
    });
  }

  if (reply.type === "wallet:error") {
    throw new WalletBridgeRemoteError(reply.error);
  }

  return reply.result;
};

export const createRemoteTrustedWalletClient = (
  transport: WalletBridgeClientTransport,
  options: RemoteTrustedWalletClientOptions = {},
): RemoteTrustedWalletClient => {
  const createRequestId = options.createRequestId ?? defaultCreateRequestId;
  return createWalletOperationClient({
    operations: walletOperations,
    call: (path, input) =>
      sendRemoteWalletOperation({
        path,
        input,
        transport,
        createRequestId,
      }),
  });
};
