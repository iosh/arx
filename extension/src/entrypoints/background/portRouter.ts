import type { RpcInvocationContext } from "@arx/core";
import {
  ArxReasons,
  arxError,
  createLogger,
  DEFAULT_NAMESPACE,
  extendLogger,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
  type RpcRegistry,
} from "@arx/core";
import { CHANNEL, type Envelope, PROTOCOL_VERSION } from "@arx/provider/protocol";
import type { JsonRpcId, JsonRpcVersion2, TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { buildRpcContext } from "./rpc";
import type { BackgroundContext } from "./serviceManager";
import type { ArxRpcContext, ControllerSnapshot, PortContext } from "./types";
import { UI_CHANNEL } from "./uiBridge";

type PendingEntry = { rpcId: JsonRpcId; jsonrpc: JsonRpcVersion2 };

type PortRouterDeps = {
  extensionOrigin: string;
  connections: Set<Runtime.Port>;
  pendingRequests: Map<Runtime.Port, Map<string, PendingEntry>>;
  portContexts: Map<Runtime.Port, PortContext>;
  getOrInitContext: () => Promise<BackgroundContext>;
  getControllerSnapshot: () => ControllerSnapshot;
  attachUiPort: (port: Runtime.Port) => Promise<void>;
};

export const createPortRouter = ({
  extensionOrigin,
  connections,
  pendingRequests,
  portContexts,
  getOrInitContext,
  getControllerSnapshot,
  attachUiPort,
}: PortRouterDeps) => {
  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "port");
  const sessionByPort = new Map<Runtime.Port, string>();
  let rpcRegistry: RpcRegistry | null = null;
  let registeredNamespaces: ReadonlySet<string> | undefined;

  const getContext = async () => {
    const ctx = await getOrInitContext();
    // Tests may stub getOrInitContext with a partial context; keep this best-effort.
    const registry = (ctx as unknown as { services?: { rpcRegistry?: RpcRegistry } }).services?.rpcRegistry;
    if (registry) {
      rpcRegistry = registry;
      registeredNamespaces = new Set(rpcRegistry.getRegisteredNamespaces());
    }
    return ctx;
  };

  const portIdByPort = new Map<Runtime.Port, string>();
  const createPortId = (): string => {
    return globalThis.crypto.randomUUID();
  };

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

  const getPermittedAccountsForPort = async (port: Runtime.Port, snapshot: ControllerSnapshot): Promise<string[]> => {
    if (!snapshot.isUnlocked) return [];
    const origin = getPortOrigin(port, extensionOrigin);
    if (origin === "unknown://") return [];

    const { controllers } = await getContext();
    const portContext = portContexts.get(port);

    const chainRef = portContext?.meta?.activeChain ?? portContext?.chainRef ?? snapshot.chain.chainRef;
    const namespace = portContext?.namespace ?? snapshot.meta.activeNamespace ?? DEFAULT_NAMESPACE;

    return controllers.permissions.getPermittedAccounts(origin, { namespace, chainRef });
  };

  const toErrorDetails = (error: unknown): Record<string, string> => {
    if (!error) return {};
    if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
    return { error: String(error) };
  };

  const dropStalePort = (port: Runtime.Port, reason: string, error?: unknown) => {
    const sessionId = sessionByPort.get(port) ?? null;
    const portId = portIdByPort.get(port) ?? null;
    if (sessionId && portId) {
      void (async () => {
        try {
          const { controllers } = await getContext();
          await controllers.approvals.expirePendingByRequestContext({
            portId,
            sessionId,
            finalStatusReason: "session_lost",
          });
        } catch (expireError) {
          const origin = getPortOrigin(port, extensionOrigin);
          portLog("failed to expire approvals on dropStalePort", { origin, ...toErrorDetails(expireError) });
        }
      })();
    }

    try {
      port.disconnect();
    } catch {
      // ignore disconnect failure
    }
    connections.delete(port);
    pendingRequests.delete(port);
    portContexts.delete(port);
    sessionByPort.delete(port);
    portIdByPort.delete(port);
    const origin = getPortOrigin(port, extensionOrigin);
    portLog("drop stale port", { origin, reason, ...toErrorDetails(error) });
  };

  const getSessionIdForPort = (port: Runtime.Port) => sessionByPort.get(port) ?? null;

  const postEnvelope = (port: Runtime.Port, envelope: Envelope): boolean => {
    try {
      port.postMessage(envelope);
      return true;
    } catch (error) {
      const origin = getPortOrigin(port, extensionOrigin);
      portLog("postMessage failed", { origin, envelopeType: envelope.type, ...toErrorDetails(error) });
      return false;
    }
  };

  const postEnvelopeOrDrop = (port: Runtime.Port, envelope: Envelope, reason: string): boolean => {
    const ok = postEnvelope(port, envelope);
    if (!ok) dropStalePort(port, reason);
    return ok;
  };

  // Helper: broadcast to all ports and clean up failed ones
  const broadcastSafe = (fn: (port: Runtime.Port) => boolean, reason: string) => {
    const stalePorts: Runtime.Port[] = [];
    // Iterate over a snapshot to avoid mutation affecting iteration.
    for (const port of [...connections]) {
      if (!fn(port)) {
        stalePorts.push(port);
      }
    }
    for (const port of stalePorts) {
      dropStalePort(port, reason);
    }
  };

  const emitEventToPort = (port: Runtime.Port, event: string, params: unknown[]) => {
    const sessionId = getSessionIdForPort(port);
    if (!sessionId) return;
    postEnvelopeOrDrop(
      port,
      {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event, params },
      },
      "emit_event_failed",
    );
  };

  const sendReply = (port: Runtime.Port, id: string, payload: TransportResponse) => {
    const sessionId = getSessionIdForPort(port);
    if (!sessionId) return;
    postEnvelopeOrDrop(
      port,
      {
        channel: CHANNEL,
        sessionId,
        type: "response",
        id,
        payload,
      },
      "send_reply_failed",
    );
  };

  const rejectPendingWithDisconnect = (port: Runtime.Port, overrideError?: JsonRpcError) => {
    const requestMap = pendingRequests.get(port);
    if (!requestMap) return;
    const portContext = portContexts.get(port);
    const rpcContext = buildRpcContext(portContext, portContext?.meta?.activeChain ?? portContext?.chainRef ?? null);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const namespace = rpcContext?.namespace ?? DEFAULT_NAMESPACE;
    const chainRef = rpcContext?.chainRef ?? null;
    const error =
      overrideError ??
      ((rpcRegistry?.encodeErrorWithAdapters(
        arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" }),
        { surface: "dapp", namespace, chainRef, origin, method: "disconnect" },
      ) ??
        // Fallback when the background context is not initialized yet.
        ({ code: 4900, message: "Disconnected" } as const)) as JsonRpcError);

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
    if (event === "accountsChanged") {
      const snapshot = getControllerSnapshot();

      for (const port of [...connections]) {
        const sessionId = getSessionIdForPort(port);
        if (!sessionId) continue;

        void (async () => {
          try {
            const accounts = await getPermittedAccountsForPort(port, snapshot);
            const ok = postEnvelope(port, {
              channel: CHANNEL,
              sessionId,
              type: "event",
              payload: { event: "accountsChanged", params: [accounts] },
            });
            if (!ok) {
              dropStalePort(port, "broadcast_accounts_changed_failed");
            }
          } catch (error) {
            dropStalePort(port, "broadcast_accounts_changed_error", error);
          }
        })();
      }

      return;
    }

    broadcastSafe((port) => {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) return true;
      return postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event, params },
      });
    }, "broadcast_event_failed");
  };

  const sendHandshakeAck = async (
    port: Runtime.Port,
    envelope: Extract<Envelope, { type: "handshake" }>,
    snapshot: ControllerSnapshot,
  ) => {
    syncPortContext(port, snapshot, portContexts, extensionOrigin, registeredNamespaces);
    sessionByPort.set(port, envelope.sessionId);

    const accounts = await getPermittedAccountsForPort(port, snapshot);

    postEnvelopeOrDrop(
      port,
      {
        channel: CHANNEL,
        sessionId: envelope.sessionId,
        type: "handshake_ack",
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          handshakeId: envelope.payload.handshakeId,
          chainId: snapshot.chain.chainId ?? "0x0",
          chainRef: snapshot.chain.chainRef,
          accounts,
          isUnlocked: snapshot.isUnlocked,
          meta: snapshot.meta,
        },
      },
      "send_handshake_failed",
    );
  };

  const broadcastDisconnect = () => {
    broadcastSafe((port) => {
      const sessionId = getSessionIdForPort(port);
      if (!sessionId) return true;
      const portContext = portContexts.get(port);
      const rpcContext = buildRpcContext(portContext, portContext?.meta?.activeChain ?? portContext?.chainRef ?? null);
      const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
      const namespace = rpcContext?.namespace ?? DEFAULT_NAMESPACE;
      const chainRef = rpcContext?.chainRef ?? null;
      const error = (rpcRegistry?.encodeErrorWithAdapters(
        arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" }),
        {
          surface: "dapp",
          namespace,
          chainRef,
          origin,
          method: "disconnect",
        },
      ) ?? ({ code: 4900, message: "Disconnected" } as const)) as JsonRpcError;
      rejectPendingWithDisconnect(port, error);
      const success = postEnvelope(port, {
        channel: CHANNEL,
        sessionId,
        type: "event",
        payload: { event: "disconnect", params: [error] },
      });
      if (success) {
        const origin = getPortOrigin(port, extensionOrigin);
        portLog("broadcastDisconnect", { origin, errorCode: error.code });
      }
      return success;
    }, "broadcast_disconnect_failed");
  };

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const { engine } = await getContext();
    const { id: rpcId, jsonrpc, method } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const portContext = portContexts.get(port);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const effectiveChainRef = portContext?.meta?.activeChain ?? portContext?.chainRef ?? null;
    const rpcContext = buildRpcContext(portContext, effectiveChainRef);

    const portId =
      portIdByPort.get(port) ??
      (() => {
        const next = createPortId();
        portIdByPort.set(port, next);
        return next;
      })();

    const requestContext = {
      transport: "provider" as const,
      portId,
      sessionId: envelope.sessionId,
      requestId: String(rpcId),
      origin,
    };

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
          requestContext,
          meta: rpcContext.meta,
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
        error: (rpcRegistry?.encodeErrorWithAdapters(error, {
          surface: "dapp",
          namespace: rpcContext?.namespace ?? DEFAULT_NAMESPACE,
          chainRef: rpcContext?.chainRef ?? null,
          origin,
          method,
        }) ?? ({ code: -32603, message: "Internal error" } as const)) as JsonRpcError,
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
    if (!portIdByPort.has(port)) {
      portIdByPort.set(port, createPortId());
    }
    const origin = getPortOrigin(port, extensionOrigin);
    portLog("connect", { origin, portName: port.name, total: connections.size });
    if (!portContexts.has(port)) {
      portContexts.set(port, {
        origin,
        meta: null,
        chainRef: null,
        chainId: null,
        namespace: DEFAULT_NAMESPACE,
      });
    }

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake": {
          void (async () => {
            // Allow session rotation: each connect attempt inpage may start a new sessionId.
            // If the session changes, drop any background-side pending tracking for the old session.
            const expectedSessionId = getSessionIdForPort(port);
            if (expectedSessionId && envelope.sessionId !== expectedSessionId) {
              clearPendingForPort(port);
              const portId = portIdByPort.get(port);
              if (portId) {
                try {
                  const { controllers } = await getContext();
                  await controllers.approvals.expirePendingByRequestContext({
                    portId,
                    sessionId: expectedSessionId,
                    finalStatusReason: "session_lost",
                  });
                } catch (error) {
                  const origin = getPortOrigin(port, extensionOrigin);
                  portLog("failed to expire approvals on session rotation", { origin, ...toErrorDetails(error) });
                }
              }
            }
            await getContext();
            const current = getControllerSnapshot();
            await sendHandshakeAck(port, envelope, current);
          })();
          break;
        }
        case "request": {
          const expectedSessionId = getSessionIdForPort(port);
          if (!expectedSessionId) {
            dropStalePort(port, "request_without_handshake");
            return;
          }
          if (envelope.sessionId !== expectedSessionId) {
            // Stale request from a previous session; ignore.
            return;
          }
          handleRpcRequest(port, envelope);
          break;
        }
        default:
          break;
      }
    };

    const handleDisconnect = () => {
      const sessionId = getSessionIdForPort(port);
      const portId = portIdByPort.get(port) ?? null;
      if (sessionId && portId) {
        void (async () => {
          try {
            const { controllers } = await getContext();
            await controllers.approvals.expirePendingByRequestContext({
              portId,
              sessionId,
              finalStatusReason: "session_lost",
            });
          } catch (error) {
            const origin = getPortOrigin(port, extensionOrigin);
            portLog("failed to expire approvals on disconnect", { origin, ...toErrorDetails(error) });
          }
        })();
      }

      try {
        rejectPendingWithDisconnect(port);
      } catch (error) {
        // Best-effort: cleanup must never throw.
        const origin = getPortOrigin(port, extensionOrigin);
        portLog("disconnect cleanup error", { origin, ...toErrorDetails(error) });
      } finally {
        connections.delete(port);
        pendingRequests.delete(port);
        portContexts.delete(port);
        sessionByPort.delete(port);
        portIdByPort.delete(port);
      }

      port.onMessage.removeListener(handleMessage);
      port.onDisconnect.removeListener(handleDisconnect);
      const disconnectOrigin = getPortOrigin(port, extensionOrigin);
      portLog("disconnect", { origin: disconnectOrigin, remaining: connections.size });
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
  };

  const syncAllPortContextsForSnapshot = (snapshot: ControllerSnapshot) => {
    syncAllPortContexts(connections, snapshot, portContexts, extensionOrigin, registeredNamespaces);
  };

  const destroy = () => {
    connections.clear();
    pendingRequests.clear();
    portContexts.clear();
    sessionByPort.clear();
    portIdByPort.clear();
  };

  return {
    handleConnect,
    broadcastEvent,
    broadcastDisconnect,
    syncAllPortContexts: syncAllPortContextsForSnapshot,
    destroy,
  };
};
