import { ArxBaseError, type ErrorCause, type SerializedArxError } from "../../error.js";
import type { Unsubscribe } from "../../messenger/topic.js";
import type { TrustedWalletApi } from "../api.js";
import { createTrustedWalletApiFromCall, type TrustedWalletApiCall } from "../apiFromCall.js";
import {
  WALLET_BRIDGE_PROTOCOL_VERSION,
  type WalletBridgeEvent,
  type WalletBridgeReply,
  type WalletBridgeRequest,
  type WalletInvalidationEvent,
} from "./protocol.js";

export type WalletBridgeClientTransport = {
  request(request: WalletBridgeRequest): Promise<WalletBridgeReply>;
  subscribe?(listener: (event: WalletBridgeEvent) => void): Unsubscribe;
};

export type RemoteTrustedWalletClientOptions = {
  createRequestId?: () => string;
};

export type RemoteTrustedWalletClient = TrustedWalletApi;

export type WalletEventApi = Readonly<{
  subscribeInvalidation(listener: (event: WalletInvalidationEvent) => void): Unsubscribe;
}>;

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

export type WalletBridgeTransportErrorReason =
  | "connect-failed"
  | "disconnected"
  | "invalid-reply"
  | "post-message-failed"
  | "request-timeout";

export class WalletBridgeTransportError extends ArxBaseError {
  static readonly code = "wallet.bridge.transport";

  constructor(input: ErrorCause & { path: string; reason: WalletBridgeTransportErrorReason; requestId: string }) {
    super(`Wallet bridge transport error for "${input.path}": ${input.reason}`, {
      code: WalletBridgeTransportError.code,
      details: {
        path: input.path,
        reason: input.reason,
        requestId: input.requestId,
      },
      cause: input.cause,
    });
  }
}

const defaultCreateRequestId = () => globalThis.crypto.randomUUID();

const sendRemoteWalletMethod = async (deps: {
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
  const call: TrustedWalletApiCall = async <TResult>(path: string, input?: unknown): Promise<TResult> =>
    (await sendRemoteWalletMethod({
      path,
      input,
      transport,
      createRequestId,
    })) as TResult;

  return createTrustedWalletApiFromCall(call);
};

export const createWalletEventApi = (transport: WalletBridgeClientTransport): WalletEventApi => ({
  subscribeInvalidation: (listener) => {
    const subscribe = transport.subscribe;
    if (!subscribe) {
      return () => {};
    }

    return subscribe((event) => {
      if (event.event !== "wallet:invalidation") {
        return;
      }

      listener({ topic: event.topic });
    });
  },
});
