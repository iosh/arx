import {
  createAsyncMiddleware,
  createBackgroundServices,
  createMethodExecutor,
  createPermissionScopeResolver,
  getProviderErrors,
  getRpcErrors,
  type Json,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
} from "@arx/core";
import type { JsonRpcResponse, JsonRpcVersion } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

const extensionOrigin = browser.runtime.getURL("").replace(/\/$/, "");
const permissionScopeResolver = createPermissionScopeResolver();

const services = createBackgroundServices({
  permissions: { scopeResolver: permissionScopeResolver },
});
const { controllers, engine } = services;

services.lifecycle.start();

const executeMethod = createMethodExecutor(controllers);

const getNamespace = () => controllers.network.getState().active.caip2;

const resolveProviderErrors = () => getProviderErrors(getNamespace());
const resolveRpcErrors = () => getRpcErrors(getNamespace());

const INTERNAL_METHODS_ALLOWING_APPROVAL = new Set(["eth_requestAccounts"]);
const isInternalOrigin = (origin: string) => origin === extensionOrigin;

const pendingRequests = new Map<browser.Runtime.Port, Map<string, { rpcId: string; jsonrpc: JsonRpcVersion }>>();

const getPendingBucket = (port: browser.Runtime.Port) => {
  let bucket = pendingRequests.get(port);
  if (!bucket) {
    bucket = new Map();
    pendingRequests.set(port, bucket);
  }

  return bucket;
};

const clearPendingForPort = (port: browser.Runtime.Port) => {
  pendingRequests.delete(port);
};

const rejectPendingWithDisconnect = (port: browser.Runtime.Port) => {
  const bucket = pendingRequests.get(port);
  if (!bucket) return;
  const error = resolveProviderErrors().disconnected().serialize();

  for (const [messageId, { rpcId, jsonrpc }] of bucket) {
    replyRequest(port, messageId, {
      id: rpcId,
      jsonrpc,
      error,
    });
  }

  clearPendingForPort(port);
};

const postEnvelope = (port: browser.Runtime.Port, envelope: Envelope) => {
  port.postMessage(envelope);
};

const emitEventToPort = (port: browser.Runtime.Port, event: string, params: unknown[]) => {
  postEnvelope(port, {
    channel: CHANNEL,
    type: "event",
    payload: { event, params },
  });
};

const replyRequest = (port: browser.Runtime.Port, id: string, payload: JsonRpcResponse) => {
  postEnvelope(port, {
    channel: CHANNEL,
    type: "response",
    id,
    payload,
  });
};
const getControllerSnapshot = () => {
  const networkState = controllers.network.getState();
  return {
    chain: { chainId: networkState.active.chainId, caip2: networkState.active.caip2 },
    accounts: controllers.accounts.getAccounts(),
  };
};

const connections = new Set<browser.Runtime.Port>();

const broadcastEvent = (event: string, params: unknown[]) => {
  for (const port of connections) {
    emitEventToPort(port, event, params);
  }
};

const unsubscribeControllerEvents: (() => void)[] = [];
unsubscribeControllerEvents.push(
  controllers.network.onChainChanged((chain) => {
    broadcastEvent("chainChanged", [chain.chainId]);
  }),
);

unsubscribeControllerEvents.push(
  controllers.accounts.onAccountsChanged((state) => {
    broadcastEvent("accountsChanged", [state.all]);
  }),
);

const resolveOrigin = (port: browser.Runtime.Port) => {
  const sender = port.sender;
  const sourceUrl = sender?.url ?? sender?.tab?.url;

  if (sourceUrl) {
    try {
      return new URL(sourceUrl).origin;
    } catch {
      // ignore parse failure
    }
  }

  if (sender?.id === browser.runtime.id) {
    return extensionOrigin;
  }

  return "unknown://";
};

const toJsonRpcError = (error: unknown, method: string): JsonRpcError => {
  if (
    error &&
    typeof error === "object" &&
    "serialize" in error &&
    typeof (error as { serialize?: unknown }).serialize === "function"
  ) {
    return (error as { serialize: () => JsonRpcError }).serialize();
  }

  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number") {
    const rpcError = error as { code: number; message?: string; data?: Json };
    return {
      code: rpcError.code,
      message: rpcError.message ?? "Unknown error",
      ...(rpcError.data !== undefined &&
        rpcError.data !== null && {
          data: rpcError.data,
        }),
    };
  }

  return resolveRpcErrors()
    .internal({
      message: `Unexpected error while handling ${method}`,
      data: { method },
    })
    .serialize();
};

engine.push(
  createAsyncMiddleware(async (req, res, next) => {
    try {
      await next();
    } catch (middlewareError) {
      if (!res.error) {
        res.error = toJsonRpcError(middlewareError, req.method);
      }
    }
  }),
);

engine.push(
  createAsyncMiddleware(async (req, _res, next) => {
    const origin = (req as { origin?: string }).origin ?? "unknown://";

    if (origin === "unknown://") {
      throw resolveProviderErrors().unauthorized({
        message: "Request origin could not be resolved",
        data: { method: req.method },
      });
    }

    if (isInternalOrigin(origin)) {
      return next();
    }

    const requiredScope = permissionScopeResolver(req.method);
    if (!requiredScope) {
      return next();
    }

    try {
      await controllers.permissions.ensurePermission(origin, req.method);
      return next();
    } catch (error) {
      if (INTERNAL_METHODS_ALLOWING_APPROVAL.has(req.method)) {
        return next();
      }

      throw resolveProviderErrors().unauthorized({
        message: `Origin ${origin} is not authorized to call ${req.method}`,
        data: { origin, method: req.method },
      });
    }
  }),
);
engine.push(
  createAsyncMiddleware(async (req, res) => {
    const origin = (req as { origin?: string }).origin ?? "unknown://";
    const result = await executeMethod({
      origin,
      request: { method: req.method, params: req.params as JsonRpcParams },
    });
    res.result = result as Json;
  }),
);

const handleRpcRequest = async (port: browser.Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
  const { id: rpcId, jsonrpc, method } = envelope.payload;
  const pendingBucket = getPendingBucket(port);
  pendingBucket.set(envelope.id, { rpcId, jsonrpc });

  const origin = resolveOrigin(port);

  const request: JsonRpcRequest<JsonRpcParams> & { origin: string } = {
    id: envelope.payload.id,
    jsonrpc: envelope.payload.jsonrpc,
    method: envelope.payload.method,
    params: envelope.payload.params as JsonRpcParams,
    origin,
  };

  try {
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      engine.handle(request, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as JsonRpcResponse);
      });
    });

    replyRequest(port, envelope.id, response);
  } catch (error) {
    replyRequest(port, envelope.id, {
      id: rpcId,
      jsonrpc,
      error: toJsonRpcError(error, method),
    });
  } finally {
    pendingBucket.delete(envelope.id);
    if (pendingBucket.size === 0) clearPendingForPort(port);
  }
};

const handleConnect = (port: browser.Runtime.Port) => {
  if (port.name !== CHANNEL) return;

  connections.add(port);

  const handleHandshake = () => {
    const current = getControllerSnapshot();
    postEnvelope(port, {
      channel: CHANNEL,
      type: "handshake_ack",
      payload: {
        chainId: current.chain.chainId,
        caip2: current.chain.caip2,
        accounts: current.accounts,
        isUnlocked: true,
      },
    });
  };

  const handleMessage = (message: unknown) => {
    const envelope = message as Envelope | undefined;
    if (!envelope || envelope.channel !== CHANNEL) return;

    switch (envelope.type) {
      case "handshake":
        handleHandshake();
        break;
      case "request": {
        handleRpcRequest(port, envelope);
        break;
      }
      default:
        break;
    }
  };

  const handleDisconnect = () => {
    emitEventToPort(port, "disconnect", []);
    rejectPendingWithDisconnect(port);
    connections.delete(port);
    port.onMessage.removeListener(handleMessage);
    port.onDisconnect.removeListener(handleDisconnect);
  };

  const initialState = getControllerSnapshot();

  emitEventToPort(port, "accountsChanged", [initialState.accounts]);
  emitEventToPort(port, "chainChanged", [initialState.chain.chainId]);

  port.onMessage.addListener(handleMessage);

  port.onDisconnect.addListener(handleDisconnect);
};

export default defineBackground(() => {
  browser.runtime.onConnect.addListener(handleConnect);
});
