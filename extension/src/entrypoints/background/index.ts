import {
  type BackgroundSessionServices,
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
  type UnlockReason,
} from "@arx/core";
import type { JsonRpcVersion2, TransportResponse } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { getExtensionStorage } from "@/platform/storage";
import { createLockedGuardMiddleware } from "./lockedMiddleware";
import { restoreUnlockState } from "./unlockRecovery";

type SessionMessage =
  | { type: "session:getStatus" }
  | { type: "session:unlock"; payload: { password: string } }
  | { type: "session:lock"; payload?: { reason?: UnlockReason } }
  | { type: "vault:initialize"; payload: { password: string } };

type BackgroundContext = {
  services: ReturnType<typeof createBackgroundServices>;
  controllers: ReturnType<typeof createBackgroundServices>["controllers"];
  engine: ReturnType<typeof createBackgroundServices>["engine"];
  session: BackgroundSessionServices;
};

let context: BackgroundContext | null = null;
let contextPromise: Promise<BackgroundContext> | null = null;

const connections = new Set<browser.Runtime.Port>();
const pendingRequests = new Map<browser.Runtime.Port, Map<string, { rpcId: string; jsonrpc: JsonRpcVersion2 }>>();
const unsubscribeControllerEvents: Array<() => void> = [];

let currentExecuteMethod: ReturnType<typeof createMethodExecutor> | null = null;
let currentResolveProviderErrors: (() => ReturnType<typeof getProviderErrors>) | null = null;
let currentResolveRpcErrors: (() => ReturnType<typeof getRpcErrors>) | null = null;

const FALLBACK_NAMESPACE = "eip155";

const handleRuntimeMessage = async (message: SessionMessage, sender: browser.Runtime.MessageSender) => {
  if (sender.id !== browser.runtime.id) {
    throw new Error("Unauthorized sender");
  }

  await ensureContext();
  if (!context) {
    throw new Error("Background context is not initialized");
  }

  const { session } = context;
  const { unlock, vault } = session;

  switch (message.type) {
    case "session:getStatus": {
      return {
        state: unlock.getState(),
        vault: vault.getStatus(),
      };
    }

    case "session:unlock": {
      const { password } = message.payload;
      await unlock.unlock({ password });
      await persistVaultMeta();
      return unlock.getState();
    }

    case "session:lock": {
      const reason = message.payload?.reason ?? "manual";
      unlock.lock(reason);
      await persistVaultMeta();
      return unlock.getState();
    }

    case "vault:initialize": {
      const { password } = message.payload;
      const ciphertext = await vault.initialize({ password });
      await persistVaultMeta();
      return { ciphertext };
    }

    default:
      throw new Error("Unknown session message");
  }
};

const persistVaultMeta = async () => {
  if (!context) {
    console.warn("[background] persistVaultMeta called before context initialized");
    return;
  }

  try {
    await context.session.persistVaultMeta();
  } catch (error) {
    console.warn("[background] failed to persist vault meta", error);
  }
};

const ensureContext = async (): Promise<BackgroundContext> => {
  if (context) {
    return context;
  }

  if (contextPromise) {
    return contextPromise;
  }

  contextPromise = (async () => {
    let namespaceResolver = () => FALLBACK_NAMESPACE;
    const storage = getExtensionStorage();

    const services = createBackgroundServices({
      permissions: {
        scopeResolver: createPermissionScopeResolver(() => namespaceResolver()),
      },
      storage: { port: storage },
    });
    const { controllers, engine, messenger, session } = services;

    const publishAccountsState = () => {
      const activePointer = controllers.accounts.getActivePointer();
      const chainRef = activePointer?.chainRef ?? controllers.network.getState().activeChain;
      const accounts = session.unlock.isUnlocked() ? controllers.accounts.getAccounts({ chainRef }) : [];
      broadcastEvent("accountsChanged", [accounts]);
    };

    await services.lifecycle.initialize();
    services.lifecycle.start();

    namespaceResolver = () => {
      const active = controllers.network.getState().activeChain;
      const [namespace] = active.split(":");
      return namespace || FALLBACK_NAMESPACE;
    };

    unsubscribeControllerEvents.push(
      session.unlock.onUnlocked((payload) => {
        broadcastEvent("session:unlocked", [payload]);
        publishAccountsState();
      }),
    );
    unsubscribeControllerEvents.push(
      session.unlock.onLocked((payload) => {
        broadcastEvent("session:locked", [payload]);
        publishAccountsState();
      }),
    );

    const lastMeta = services.session.getLastPersistedVaultMeta();
    const persistedUnlockState = lastMeta?.payload.unlockState;
    if (persistedUnlockState) {
      restoreUnlockState({
        controller: session.unlock,
        snapshot: persistedUnlockState,
        snapshotCapturedAt: lastMeta.updatedAt,
        now: () => Date.now(),
      });
    }

    const executeMethod = createMethodExecutor(controllers);
    const getNamespace = () => controllers.network.getState().activeChain;
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
      createLockedGuardMiddleware({
        isUnlocked: () => session.unlock.isUnlocked(),
        isInternalOrigin,
        resolveMethodDefinition,
        resolveProviderErrors,
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
        broadcastEvent("chainChanged", [
          {
            chainId: chain.chainId,
            caip2: chain.chainRef,
            isUnlocked: session.unlock.isUnlocked(),
          },
        ]);
      }),
    );
    unsubscribeControllerEvents.push(
      controllers.accounts.onStateChanged(() => {
        publishAccountsState();
      }),
    );

    context = { services, controllers, engine, session };
    currentExecuteMethod = executeMethod;
    currentResolveProviderErrors = resolveProviderErrors;
    currentResolveRpcErrors = resolveRpcErrors;

    return context;
  })();

  try {
    return await contextPromise;
  } finally {
    contextPromise = null;
  }
};
const extensionOrigin = browser.runtime.getURL("").replace(/\/$/, "");

const getActiveControllers = () => {
  if (!context) {
    throw new Error("Background context is not initialized");
  }
  return context.controllers;
};
const getActiveProviderErrors = () => {
  if (!context || !currentResolveProviderErrors) {
    throw new Error("Background context is not initialized");
  }
  return currentResolveProviderErrors();
};
const getActiveRpcErrors = () => {
  if (!context || !currentResolveRpcErrors) {
    throw new Error("Background context is not initialized");
  }
  return currentResolveRpcErrors();
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
  if (!context) throw new Error("Background context is not initialized");
  const { controllers, session } = context;
  const activeChain = controllers.network.getActiveChain();
  const active = controllers.accounts.getActivePointer();
  const isUnlocked = session.unlock.isUnlocked();
  const chainRef = active?.chainRef ?? activeChain.chainRef;
  const accounts = isUnlocked ? controllers.accounts.getAccounts({ chainRef }) : [];

  return {
    chain: { chainId: activeChain.chainId, caip2: activeChain.chainRef },
    accounts,
    isUnlocked,
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
  const { engine } = await ensureContext();
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

  const handleHandshake = async () => {
    await ensureContext();

    const current = getControllerSnapshot();

    postEnvelope(port, {
      channel: CHANNEL,
      type: "handshake_ack",
      payload: {
        chainId: current.chain.chainId,
        caip2: current.chain.caip2,
        accounts: current.accounts,
        isUnlocked: current.isUnlocked,
      },
    });
  };

  const handleMessage = (message: unknown) => {
    const envelope = message as Envelope | undefined;
    if (!envelope || envelope.channel !== CHANNEL) return;

    switch (envelope.type) {
      case "handshake":
        void handleHandshake();
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

const runtimeMessageProxy = (message: unknown, sender: browser.Runtime.MessageSender) => {
  return handleRuntimeMessage(message as SessionMessage, sender);
};

export default defineBackground(() => {
  void ensureContext();

  browser.runtime.onConnect.addListener(handleConnect);
  browser.runtime.onMessage.addListener(runtimeMessageProxy);

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
