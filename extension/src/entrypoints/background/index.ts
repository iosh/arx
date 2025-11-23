import {
  type BackgroundSessionServices,
  createAsyncMiddleware,
  createBackgroundServices,
  createMethodDefinitionResolver,
  createMethodExecutor,
  createNamespaceResolver,
  createPermissionGuardMiddleware,
  createPermissionScopeResolver,
  DEFAULT_NAMESPACE,
  getProviderErrors,
  getRegisteredNamespaceAdapters,
  getRpcErrors,
  type Json,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
  type RpcInvocationContext,
  type UnlockReason,
} from "@arx/core";
import type { JsonRpcId, JsonRpcVersion2, TransportMeta, TransportResponse } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { getExtensionChainRegistry, getExtensionStorage } from "@/platform/storage";
import { createLockedGuardMiddleware } from "./lockedMiddleware";
import { createUiBridge, UI_CHANNEL } from "./uiBridge";
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
let uiBridge: ReturnType<typeof createUiBridge> | null = null;
type PortContext = {
  origin: string;
  meta: TransportMeta | null;
  caip2: string | null;
  chainId: string | null;
  namespace: string;
};

const connections = new Set<browser.Runtime.Port>();
const pendingRequests = new Map<browser.Runtime.Port, Map<string, { rpcId: JsonRpcId; jsonrpc: JsonRpcVersion2 }>>();
const portContexts = new Map<browser.Runtime.Port, PortContext>();
const unsubscribeControllerEvents: Array<() => void> = [];

let currentExecuteMethod: ReturnType<typeof createMethodExecutor> | null = null;
let currentResolveProviderErrors: ((context?: RpcInvocationContext) => ReturnType<typeof getProviderErrors>) | null =
  null;
let currentResolveRpcErrors: ((context?: RpcInvocationContext) => ReturnType<typeof getRpcErrors>) | null = null;

type ArxRpcContext = {
  origin: string;
  arx?: (RpcInvocationContext & { meta: TransportMeta | null }) | undefined;
};

type ControllerSnapshot = {
  chain: { chainId: string; caip2: string };
  accounts: string[];
  isUnlocked: boolean;
  meta: {
    activeChain: string;
    activeNamespace: string;
    supportedChains: string[];
  };
};

const isNamespaceRegistered = (namespace: string | null | undefined) => {
  if (!namespace || namespace.length === 0) {
    return false;
  }
  return getRegisteredNamespaceAdapters().some((adapter) => adapter.namespace === namespace);
};

const resolveNamespace = (caip2: string | null, metaNamespace?: string): string => {
  if (metaNamespace) {
    if (isNamespaceRegistered(metaNamespace)) {
      return metaNamespace;
    }
    console.warn(
      `[background] Namespace "${metaNamespace}" has no registered adapter; falling back to ${DEFAULT_NAMESPACE}`,
    );
    return DEFAULT_NAMESPACE;
  }
  if (caip2) {
    const [namespace] = caip2.split(":");
    if (namespace && isNamespaceRegistered(namespace)) {
      return namespace;
    }
  }
  return DEFAULT_NAMESPACE;
};

const syncPortContext = (port: browser.Runtime.Port, snapshot: ControllerSnapshot) => {
  const existing = portContexts.get(port);
  const resolvedOrigin = resolveOrigin(port);
  const origin = existing?.origin && existing.origin !== "unknown://" ? existing.origin : resolvedOrigin;
  const caip2 = snapshot.meta?.activeChain ?? snapshot.chain.caip2 ?? null;
  const namespace = resolveNamespace(caip2, snapshot.meta?.activeNamespace);

  portContexts.set(port, {
    origin,
    meta: snapshot.meta ?? null,
    caip2,
    chainId: snapshot.chain.chainId ?? null,
    namespace,
  });
};

const syncAllPortContexts = (snapshot: ControllerSnapshot) => {
  for (const port of connections) {
    syncPortContext(port, snapshot);
  }
};

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
      throw new Error(`Unknown runtime message: ${message}`);
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
    let resolveNamespaceRef: (ctx?: RpcInvocationContext) => string = () => DEFAULT_NAMESPACE;
    const namespaceResolver = (ctx?: RpcInvocationContext) => resolveNamespaceRef(ctx);
    const storage = getExtensionStorage();
    const chainRegistry = getExtensionChainRegistry();

    const permissionScopeResolver = createPermissionScopeResolver(namespaceResolver);
    const services = createBackgroundServices({
      permissions: {
        scopeResolver: permissionScopeResolver,
      },
      storage: { port: storage },
      chainRegistry: { port: chainRegistry },
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

    resolveNamespaceRef = createNamespaceResolver(controllers);

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

    unsubscribeControllerEvents.push(
      controllers.network.onStateChanged(() => {
        const snapshot = getControllerSnapshot();
        syncAllPortContexts(snapshot);
        broadcastEvent("metaChanged", [snapshot.meta]);
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
    const resolveProviderErrors = (rpcContext?: RpcInvocationContext) =>
      getProviderErrors(namespaceResolver(rpcContext));
    const resolveRpcErrors = (rpcContext?: RpcInvocationContext) => getRpcErrors(namespaceResolver(rpcContext));
    const resolveMethodDefinition = createMethodDefinitionResolver(controllers);

    const readLockedPoliciesForChain = (chainRef: string | null | undefined) => {
      if (!chainRef) {
        return null;
      }
      const typed = chainRef;
      const networkChain = controllers.network.getChain(typed);
      if (networkChain?.providerPolicies?.locked) {
        return networkChain.providerPolicies.locked;
      }
      const registryEntity = controllers.chainRegistry.getChain(typed);
      return registryEntity?.metadata.providerPolicies?.locked ?? null;
    };

    const resolveLockedPolicy = (method: string, rpcContext?: RpcInvocationContext) => {
      const chainRef = rpcContext?.chainRef ?? controllers.network.getActiveChain().chainRef;
      const policies = readLockedPoliciesForChain(chainRef);
      if (!policies) {
        return undefined;
      }

      const pick = (key: string) => (Object.hasOwn(policies, key) ? policies[key] : undefined);
      const selected = pick(method);
      const fallback = selected === undefined ? pick("*") : undefined;
      const value = selected ?? fallback;

      if (value === undefined || value === null) {
        return undefined;
      }

      return {
        allow: value.allow,
        response: value.response,
        hasResponse: Object.hasOwn(value, "response"),
      } as const;
    };

    engine.push(
      createAsyncMiddleware(async (req, res, next) => {
        const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
        try {
          await next();
        } catch (middlewareError) {
          res.error = toJsonRpcError(middlewareError, req.method, rpcContext ?? undefined);
        }
      }),
    );
    engine.push(
      createLockedGuardMiddleware({
        isUnlocked: () => session.unlock.isUnlocked(),
        isInternalOrigin,
        resolveMethodDefinition,
        resolveLockedPolicy,
        resolveProviderErrors,
      }),
    );

    engine.push(
      createPermissionGuardMiddleware({
        ensurePermission: (origin, method, context) =>
          controllers.permissions.ensurePermission(origin, method, context),
        isInternalOrigin,
        resolveMethodDefinition,
        resolveProviderErrors,
      }),
    );

    engine.push(
      createAsyncMiddleware(async (req, _res, next) => {
        const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
        const definition = resolveMethodDefinition(req.method, rpcContext ?? undefined);
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
        const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
        const result = await executeMethod({
          origin,
          request: { method: req.method, params: req.params as JsonRpcParams },
          context: rpcContext ?? undefined,
        });
        res.result = result as Json;
      }),
    );

    unsubscribeControllerEvents.push(
      controllers.network.onChainChanged(() => {
        // Rebuild the snapshot so meta stays consistent with accounts and lock state.
        const snapshot = getControllerSnapshot();
        syncAllPortContexts(snapshot);
        broadcastEvent("chainChanged", [
          {
            chainId: snapshot.chain.chainId,
            caip2: snapshot.chain.caip2,
            isUnlocked: snapshot.isUnlocked,
            meta: snapshot.meta,
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

    uiBridge = createUiBridge({
      controllers,
      session,
      persistVaultMeta,
    });
    uiBridge.attachListeners();

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
const getActiveProviderErrors = (rpcContext?: RpcInvocationContext) => {
  if (!context || !currentResolveProviderErrors) {
    throw new Error("Background context is not initialized");
  }
  return currentResolveProviderErrors(rpcContext);
};
const getActiveRpcErrors = (rpcContext?: RpcInvocationContext) => {
  if (!context || !currentResolveRpcErrors) {
    throw new Error("Background context is not initialized");
  }
  return currentResolveRpcErrors(rpcContext);
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
  const portContext = portContexts.get(port);
  const error = getActiveProviderErrors(
    portContext
      ? {
          namespace: portContext.namespace,
          chainRef: portContext.meta?.activeChain ?? portContext.caip2 ?? null,
          meta: portContext.meta,
        }
      : undefined,
  )
    .disconnected()
    .serialize();

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
const getControllerSnapshot = (): ControllerSnapshot => {
  if (!context) throw new Error("Background context is not initialized");
  const { controllers, session } = context;
  const activeChain = controllers.network.getActiveChain();
  const networkState = controllers.network.getState();
  const active = controllers.accounts.getActivePointer();
  const isUnlocked = session.unlock.isUnlocked();
  const chainRef = active?.chainRef ?? activeChain.chainRef;
  const accounts = isUnlocked ? controllers.accounts.getAccounts({ chainRef }) : [];

  return {
    chain: { chainId: activeChain.chainId, caip2: activeChain.chainRef },
    accounts,
    isUnlocked,
    meta: {
      activeChain: activeChain.chainRef,
      activeNamespace: activeChain.namespace,
      supportedChains: networkState.knownChains.map((chain) => chain.chainRef),
    },
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

const toJsonRpcError = (error: unknown, method: string, rpcContext?: RpcInvocationContext): JsonRpcError => {
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

  return getActiveRpcErrors(rpcContext)
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

  const portContext = portContexts.get(port);
  const origin = portContext?.origin ?? resolveOrigin(port);
  const effectiveChainRef = portContext?.meta?.activeChain ?? portContext?.caip2 ?? null;
  const rpcContext = portContext
    ? {
        namespace: portContext.namespace,
        chainRef: effectiveChainRef ?? portContext.caip2 ?? null,
        meta: portContext.meta,
      }
    : undefined;

  const request: JsonRpcRequest<JsonRpcParams> & ArxRpcContext = {
    id: envelope.payload.id,
    jsonrpc: envelope.payload.jsonrpc,
    method: envelope.payload.method,
    params: envelope.payload.params as JsonRpcParams,
    origin,
    ...(portContext && {
      arx: {
        chainRef: effectiveChainRef,
        namespace: portContext.namespace,
        meta: portContext.meta,
      },
    }),
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
      error: toJsonRpcError(error, method, rpcContext),
    });
  } finally {
    pendingBucket.delete(envelope.id);
    if (pendingBucket.size === 0) clearPendingForPort(port);
  }
};

const handleConnect = (port: browser.Runtime.Port) => {
  if (port.name === UI_CHANNEL) {
    void ensureContext().then(() => uiBridge?.attachPort(port));
    return;
  }
  if (port.name !== CHANNEL) return;

  connections.add(port);
  if (!portContexts.has(port)) {
    portContexts.set(port, {
      origin: resolveOrigin(port),
      meta: null,
      caip2: null,
      chainId: null,
      namespace: DEFAULT_NAMESPACE,
    });
  }

  const handleHandshake = async () => {
    await ensureContext();

    const current = getControllerSnapshot();
    syncPortContext(port, current);

    postEnvelope(port, {
      channel: CHANNEL,
      type: "handshake_ack",
      payload: {
        chainId: current.chain.chainId ?? "0x0",
        caip2: current.chain.caip2,
        accounts: current.accounts,
        isUnlocked: current.isUnlocked,
        meta: current.meta,
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
    portContexts.delete(port);
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
      portContexts.clear();

      uiBridge?.teardown();
      uiBridge = null;
      context?.services.lifecycle.destroy();
      context = null;
      currentExecuteMethod = null;
      currentResolveProviderErrors = null;
      currentResolveRpcErrors = null;
    });
  }
});
