import {
  createAsyncMiddleware,
  createBackgroundServices,
  createMethodDefinitionResolver,
  createMethodExecutor,
  createPermissionScopeResolver,
  getProviderErrors,
  getRpcErrors,
  type Json,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
} from "@arx/core";
import type { JsonRpcVersion2, TransportResponse } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

type BackgroundContext = {
  services: ReturnType<typeof createBackgroundServices>;
  controllers: ReturnType<typeof createBackgroundServices>["controllers"];
  engine: ReturnType<typeof createBackgroundServices>["engine"];
};

let context: BackgroundContext | null = null;
const connections = new Set<browser.Runtime.Port>();
const pendingRequests = new Map<browser.Runtime.Port, Map<string, { rpcId: string; jsonrpc: JsonRpcVersion2 }>>();
const unsubscribeControllerEvents: Array<() => void> = [];

let currentExecuteMethod: ReturnType<typeof createMethodExecutor> | null = null;
let currentResolveProviderErrors: (() => ReturnType<typeof getProviderErrors>) | null = null;
let currentResolveRpcErrors: (() => ReturnType<typeof getRpcErrors>) | null = null;

const FALLBACK_NAMESPACE = "eip155";

const ensureContext = () => {
  if (context) return context;

  let namespaceResolver = () => FALLBACK_NAMESPACE;

  const services = createBackgroundServices({
    permissions: {
      scopeResolver: createPermissionScopeResolver(() => namespaceResolver()),
    },
  });
  const { controllers, engine } = services;

  namespaceResolver = () => {
    const active = controllers.network.getState().active;
    const [namespace] = active.caip2.split(":");
    return namespace || FALLBACK_NAMESPACE;
  };

  services.lifecycle.start();

  const executeMethod = createMethodExecutor(controllers);
  const getNamespace = () => controllers.network.getState().active.caip2;
  const resolveProviderErrors = () => getProviderErrors(getNamespace());
  const resolveRpcErrors = () => getRpcErrors(getNamespace());
  const resolveMethodDefinition = createMethodDefinitionResolver(controllers);

  engine.push(
    createAsyncMiddleware(async (req, res, next) => {
      try {
        await next();
      } catch (middlewareError) {
        res.error = toJsonRpcError(middlewareError, req.method);
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

      const definition = resolveMethodDefinition(req.method);
      const scope = definition?.scope;
      if (!scope) {
        return next();
      }

      try {
        await controllers.permissions.ensurePermission(origin, req.method);
        return next();
      } catch (error) {
        const maybeError = error as { code?: unknown };
        const code = typeof maybeError.code === "number" ? maybeError.code : undefined;
        const isPermissionError = code === 4001 || code === 4100;

        if (!isPermissionError) {
          throw error;
        }

        if (definition?.approvalRequired === true) {
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
    createAsyncMiddleware(async (req, _res, next) => {
      const definition = resolveMethodDefinition(req.method);
      if (!definition?.approvalRequired) {
        return next();
      }

      // TODO: integrate approval UI/flow here
      return next();
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

  context = { services, controllers, engine };
  currentExecuteMethod = executeMethod;
  currentResolveProviderErrors = resolveProviderErrors;
  currentResolveRpcErrors = resolveRpcErrors;

  return context;
};
const extensionOrigin = browser.runtime.getURL("").replace(/\/$/, "");

const getActiveControllers = () => ensureContext().controllers;

const getActiveProviderErrors = () => {
  ensureContext();
  return currentResolveProviderErrors!();
};

const getActiveRpcErrors = () => {
  ensureContext();
  return currentResolveRpcErrors!();
};

const isInternalOrigin = (origin: string) => origin === extensionOrigin;

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
  const error = getActiveProviderErrors().disconnected().serialize();

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

const replyRequest = (port: browser.Runtime.Port, id: string, payload: TransportResponse) => {
  postEnvelope(port, {
    channel: CHANNEL,
    type: "response",
    id,
    payload,
  });
};
const getControllerSnapshot = () => {
  const controllers = getActiveControllers();
  const networkState = controllers.network.getState();
  return {
    chain: { chainId: networkState.active.chainId, caip2: networkState.active.caip2 },
    accounts: controllers.accounts.getAccounts(),
  };
};

const broadcastEvent = (event: string, params: unknown[]) => {
  for (const port of connections) {
    emitEventToPort(port, event, params);
  }
};

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

  return getActiveRpcErrors()
    .internal({
      message: `Unexpected error while handling ${method}`,
      data: { method },
    })
    .serialize();
};

const handleRpcRequest = async (port: browser.Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
  const { engine } = ensureContext();
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
    const response = await new Promise<TransportResponse>((resolve, reject) => {
      engine.handle(request, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as TransportResponse);
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
    rejectPendingWithDisconnect(port);
    emitEventToPort(port, "disconnect", []);
    connections.delete(port);
    port.onMessage.removeListener(handleMessage);
    port.onDisconnect.removeListener(handleDisconnect);
  };

  port.onMessage.addListener(handleMessage);

  port.onDisconnect.addListener(handleDisconnect);
};

export default defineBackground(() => {
  ensureContext();
  browser.runtime.onConnect.addListener(handleConnect);

  if (browser.runtime.onSuspend) {
    browser.runtime.onSuspend.addListener(() => {
      browser.runtime.onConnect.removeListener(handleConnect);

      const toUnsubscribe = [...unsubscribeControllerEvents];
      unsubscribeControllerEvents.length = 0;

      for (const unsubscribe of toUnsubscribe) {
        unsubscribe();
      }
      connections.clear();
      pendingRequests.clear();

      context?.services.lifecycle.destroy();
      context = null;
      currentExecuteMethod = null;
      currentResolveProviderErrors = null;
      currentResolveRpcErrors = null;
    });
  }
});
