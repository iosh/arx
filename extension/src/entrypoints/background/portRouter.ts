import type { RpcInvocationContext } from "@arx/core";
import {
  createLogger,
  DEFAULT_NAMESPACE,
  extendLogger,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
} from "@arx/core";
import type { JsonRpcId, JsonRpcVersion2, TransportResponse } from "@arx/provider-core/types";
import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import type { Runtime } from "webextension-polyfill";
import { resolveOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { buildRpcContext, type ProviderErrorResolver, type RpcErrorResolver, toJsonRpcError } from "./rpc";
import type { BackgroundContext } from "./serviceManager";
import type { ArxRpcContext, ControllerSnapshot, PortContext } from "./types";
import { UI_CHANNEL } from "./uiBridge";

type PendingEntry = { rpcId: JsonRpcId; jsonrpc: JsonRpcVersion2 };

type PortRouterDeps = {
  extensionOrigin: string;
  connections: Set<Runtime.Port>;
  pendingRequests: Map<Runtime.Port, Map<string, PendingEntry>>;
  portContexts: Map<Runtime.Port, PortContext>;
  ensureContext: () => Promise<BackgroundContext>;
  getControllerSnapshot: () => ControllerSnapshot;
  attachUiPort: (port: Runtime.Port) => Promise<void>;
  getActiveProviderErrors: ProviderErrorResolver;
  getActiveRpcErrors: RpcErrorResolver;
};

export const createPortRouter = ({
  extensionOrigin,
  connections,
  pendingRequests,
  portContexts,
  ensureContext,
  getControllerSnapshot,
  attachUiPort,
  getActiveProviderErrors,
  getActiveRpcErrors,
}: PortRouterDeps) => {
  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "port");

  const getPendingRequestMap = (port: Runtime.Port) => {
    let requestMap = pendingRequests.get(port);
    if (!requestMap) {
      requestMap = new Map();
      pendingRequests.set(port, requestMap);
    }
    return requestMap;
  };

  const clearPendingForPort = (port: Runtime.Port) => {
    pendingRequests.delete(port);
  };

  const postEnvelope = (port: Runtime.Port, envelope: Envelope) => {
    port.postMessage(envelope);
  };

  const emitEventToPort = (port: Runtime.Port, event: string, params: unknown[]) => {
    postEnvelope(port, {
      channel: CHANNEL,
      type: "event",
      payload: { event, params },
    });
  };

  const sendReply = (port: Runtime.Port, id: string, payload: TransportResponse) => {
    postEnvelope(port, {
      channel: CHANNEL,
      type: "response",
      id,
      payload,
    });
  };

  const rejectPendingWithDisconnect = (port: Runtime.Port, overrideError?: JsonRpcError) => {
    const requestMap = pendingRequests.get(port);
    if (!requestMap) return;
    const portContext = portContexts.get(port);
    const rpcContext = buildRpcContext(
      portContext,
      portContext?.meta?.activeChain ?? portContext?.caip2 ?? null,
      getActiveProviderErrors,
      getActiveRpcErrors,
    );
    const providerErrors = rpcContext?.errors?.provider ?? getActiveProviderErrors(rpcContext);
    const error = overrideError ?? providerErrors.disconnected().serialize();

    for (const [messageId, { rpcId, jsonrpc }] of requestMap) {
      sendReply(port, messageId, {
        id: rpcId,
        jsonrpc,
        error,
      });
    }

    clearPendingForPort(port);
  };

  const broadcastEvent = (event: string, params: unknown[]) => {
    for (const port of connections) {
      emitEventToPort(port, event, params);
    }
  };

  const sendHandshakeAck = (port: Runtime.Port, snapshot: ControllerSnapshot) => {
    syncPortContext(port, snapshot, portContexts, extensionOrigin);
    postEnvelope(port, {
      channel: CHANNEL,
      type: "handshake_ack",
      payload: {
        chainId: snapshot.chain.chainId ?? "0x0",
        caip2: snapshot.chain.caip2,
        accounts: snapshot.accounts,
        isUnlocked: snapshot.isUnlocked,
        meta: snapshot.meta,
      },
    });
  };

  const broadcastHandshakeAck = (snapshot: ControllerSnapshot) => {
    for (const port of connections) {
      sendHandshakeAck(port, snapshot);
    }
  };

  const getProviderErrorsForPort = (port: Runtime.Port) => {
    const portContext = portContexts.get(port);
    const rpcContext = buildRpcContext(
      portContext,
      portContext?.meta?.activeChain ?? portContext?.caip2 ?? null,
      getActiveProviderErrors,
      getActiveRpcErrors,
    );
    if (rpcContext?.errors?.provider) {
      return rpcContext.errors.provider;
    }
    return getActiveProviderErrors(rpcContext);
  };

  const broadcastDisconnect = () => {
    for (const port of connections) {
      const error = getProviderErrorsForPort(port).disconnected().serialize();
      rejectPendingWithDisconnect(port, error);
      emitEventToPort(port, "disconnect", [error]);
      const origin = resolveOrigin(port, extensionOrigin) || "unknown://";
      portLog("broadcastDisconnect", { origin, errorCode: error.code });
    }
  };

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const { engine } = await ensureContext();
    const { id: rpcId, jsonrpc, method } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const portContext = portContexts.get(port);
    const origin = portContext?.origin ?? resolveOrigin(port, extensionOrigin);
    const effectiveChainRef = portContext?.meta?.activeChain ?? portContext?.caip2 ?? null;
    const rpcContext = buildRpcContext(portContext, effectiveChainRef, getActiveProviderErrors, getActiveRpcErrors);

    const request: JsonRpcRequest<JsonRpcParams> & ArxRpcContext = {
      id: envelope.payload.id,
      jsonrpc: envelope.payload.jsonrpc,
      method: envelope.payload.method,
      params: envelope.payload.params as JsonRpcParams,
      origin,
      ...(rpcContext && {
        arx: {
          chainRef: rpcContext.chainRef,
          namespace: rpcContext.namespace,
          meta: rpcContext.meta,
          errors: rpcContext.errors,
        } satisfies RpcInvocationContext,
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

      sendReply(port, envelope.id, response);
    } catch (error) {
      sendReply(port, envelope.id, {
        id: rpcId,
        jsonrpc,
        error: toJsonRpcError(error, method, rpcContext, getActiveRpcErrors),
      });
    } finally {
      pendingRequestMap.delete(envelope.id);
      if (pendingRequestMap.size === 0) clearPendingForPort(port);
    }
  };

  const handleConnect = (port: Runtime.Port) => {
    if (port.name === UI_CHANNEL) {
      void attachUiPort(port);
      return;
    }
    if (port.name !== CHANNEL) return;

    connections.add(port);
    const origin = resolveOrigin(port, extensionOrigin) || "unknown://";
    portLog("connect", { origin, portName: port.name, total: connections.size });
    if (!portContexts.has(port)) {
      portContexts.set(port, {
        origin,
        meta: null,
        caip2: null,
        chainId: null,
        namespace: DEFAULT_NAMESPACE,
      });
    }

    const handleHandshake = async () => {
      await ensureContext();
      const current = getControllerSnapshot();
      sendHandshakeAck(port, current);
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
      const disconnectOrigin = resolveOrigin(port, extensionOrigin) || "unknown://";
      portLog("disconnect", { origin: disconnectOrigin, remaining: connections.size });
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
  };

  const syncAllPortContextsForSnapshot = (snapshot: ControllerSnapshot) => {
    syncAllPortContexts(connections, snapshot, portContexts, extensionOrigin);
  };

  const destroy = () => {
    connections.clear();
    pendingRequests.clear();
    portContexts.clear();
  };

  return {
    handleConnect,
    broadcastEvent,
    broadcastHandshakeAck,
    broadcastDisconnect,
    syncAllPortContexts: syncAllPortContextsForSnapshot,
    destroy,
  };
};
