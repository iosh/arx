import type { RpcInvocationContext } from "@arx/core";
import {
  ArxReasons,
  arxError,
  createLogger,
  extendLogger,
  type JsonRpcError,
  type JsonRpcParams,
  type JsonRpcRequest,
  type RpcRegistry,
} from "@arx/core";
import { CHANNEL, type Envelope, PROTOCOL_VERSION, PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { JsonRpcId, JsonRpcVersion2, TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { buildRpcContext, deriveRpcContextNamespace } from "./rpc";
import type { BackgroundContext } from "./runtimeHost";
import type { ArxRpcContext, PortContext, ProviderBridgeSnapshot } from "./types";

type PendingEntry = { rpcId: JsonRpcId; jsonrpc: JsonRpcVersion2 };

type PortRouterDeps = {
  extensionOrigin: string;
  getOrInitContext: () => Promise<BackgroundContext>;
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot;
};

const parseHandshakeNamespace = (envelope: Extract<Envelope, { type: "handshake" }>) => {
  const namespace = envelope.payload.namespace.trim();
  return namespace.length > 0 ? namespace : null;
};

export const createPortRouter = ({ extensionOrigin, getOrInitContext, getProviderSnapshot }: PortRouterDeps) => {
  const connections = new Set<Runtime.Port>();
  const pendingRequests = new Map<Runtime.Port, Map<string, PendingEntry>>();
  const portContexts = new Map<Runtime.Port, PortContext>();
  const messageHandlers = new Map<Runtime.Port, (message: unknown) => void>();
  const disconnectHandlers = new Map<Runtime.Port, () => void>();

  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "port");
  const sessionByPort = new Map<Runtime.Port, string>();
  let rpcRegistry: RpcRegistry | null = null;

  const getContext = async () => {
    const ctx = await getOrInitContext();
    const registry = ctx.runtime.rpc.registry;
    rpcRegistry = registry;
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

  const toErrorDetails = (error: unknown): Record<string, string> => {
    if (!error) return {};
    if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
    return { error: String(error) };
  };

  const detachPortListeners = (port: Runtime.Port) => {
    const onMessage = messageHandlers.get(port);
    if (onMessage) {
      try {
        port.onMessage.removeListener(onMessage);
      } catch {
        // ignore
      }
      messageHandlers.delete(port);
    }

    const onDisconnect = disconnectHandlers.get(port);
    if (onDisconnect) {
      try {
        port.onDisconnect.removeListener(onDisconnect);
      } catch {
        // ignore
      }
      disconnectHandlers.delete(port);
    }
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

  const dropStalePort = (port: Runtime.Port, reason: string, error?: unknown) => {
    const sessionId = sessionByPort.get(port) ?? null;
    const portId = portIdByPort.get(port) ?? null;
    if (sessionId && portId) {
      void (async () => {
        try {
          const { controllers } = await getContext();
          await controllers.approvals.cancelByScope({
            scope: {
              transport: "provider",
              origin: getPortOrigin(port, extensionOrigin),
              portId,
              sessionId,
            },
            reason: "session_lost",
          });
        } catch (expireError) {
          const origin = getPortOrigin(port, extensionOrigin);
          portLog("failed to expire approvals on dropStalePort", { origin, ...toErrorDetails(expireError) });
        }
      })();
    }

    try {
      detachPortListeners(port);
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

  const postEnvelopeOrDrop = (port: Runtime.Port, envelope: Envelope, reason: string): boolean => {
    const ok = postEnvelope(port, envelope);
    if (!ok) dropStalePort(port, reason);
    return ok;
  };

  const broadcastSafe = (
    shouldInclude: (port: Runtime.Port) => boolean,
    send: (port: Runtime.Port) => boolean,
    reason: string,
  ) => {
    const stalePorts: Runtime.Port[] = [];
    for (const port of getConnectedPorts()) {
      if (!shouldInclude(port)) continue;
      if (!send(port)) {
        stalePorts.push(port);
      }
    }
    for (const port of stalePorts) {
      dropStalePort(port, reason);
    }
  };

  const getConnectedPorts = () => {
    return [...connections];
  };

  const listConnectedNamespaces = () => {
    const namespaces = new Set<string>();
    for (const portContext of portContexts.values()) {
      if (portContext.providerNamespace) {
        namespaces.add(portContext.providerNamespace);
      }
    }
    return [...namespaces];
  };

  const findProviderSnapshot = (namespace: string): ProviderBridgeSnapshot | null => {
    try {
      return getProviderSnapshot(namespace);
    } catch (error) {
      portLog("failed to get provider snapshot", { namespace, ...toErrorDetails(error) });
      return null;
    }
  };

  const findPortSnapshot = (port: Runtime.Port): ProviderBridgeSnapshot | null => {
    const namespace = portContexts.get(port)?.providerNamespace;
    if (!namespace) return null;
    return findProviderSnapshot(namespace);
  };

  const getPortsBoundToNamespaces = (namespaces: Iterable<string>) => {
    const allowed = new Set(namespaces);
    return getConnectedPorts().filter((port) => {
      const namespace = portContexts.get(port)?.providerNamespace;
      return typeof namespace === "string" && allowed.has(namespace);
    });
  };

  const getPermittedAccountsForPort = async (
    port: Runtime.Port,
    snapshot: ProviderBridgeSnapshot,
  ): Promise<string[]> => {
    if (!snapshot.isUnlocked) return [];

    const origin = getPortOrigin(port, extensionOrigin);
    if (origin === "unknown://") return [];

    const { controllers, permissionViews } = await getContext();
    const portContext = portContexts.get(port);
    const chainRef = portContext?.chainRef ?? snapshot.chain.chainRef;
    return permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) =>
        controllers.chainAddressCodecs.formatAddress({ chainRef, canonical: account.canonicalAddress }),
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
    const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const namespace = deriveRpcContextNamespace(rpcContext);
    const chainRef = rpcContext?.chainRef ?? null;
    const error =
      overrideError ??
      ((rpcRegistry?.encodeErrorWithAdapters(
        arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" }),
        { surface: "dapp", namespace, chainRef, origin, method: PROVIDER_EVENTS.disconnect },
      ) ?? ({ code: 4900, message: "Disconnected" } as const)) as JsonRpcError);

    for (const [messageId, { rpcId, jsonrpc }] of requestMap) {
      sendReply(port, messageId, {
        id: rpcId,
        jsonrpc,
        error,
      });
    }

    clearPendingForPort(port);
  };

  const syncPortContextsForPorts = (ports: Runtime.Port[]) => {
    syncAllPortContexts(ports, findPortSnapshot, portContexts, extensionOrigin);
  };

  const broadcastMetaChangedForNamespaces = (namespaces: Iterable<string>) => {
    const targetPorts = getPortsBoundToNamespaces(namespaces);
    syncPortContextsForPorts(targetPorts);
    const targetPortSet = new Set(targetPorts);

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        const snapshot = findPortSnapshot(port);
        if (!sessionId || !snapshot) return false;
        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event: PROVIDER_EVENTS.metaChanged, params: [snapshot.meta] },
        });
      },
      "broadcast_meta_changed_failed",
    );
  };

  const broadcastChainChangedForNamespaces = (namespaces: Iterable<string>) => {
    const targetPorts = getPortsBoundToNamespaces(namespaces);
    syncPortContextsForPorts(targetPorts);
    const targetPortSet = new Set(targetPorts);

    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        const snapshot = findPortSnapshot(port);
        if (!sessionId || !snapshot) return false;
        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: {
            event: PROVIDER_EVENTS.chainChanged,
            params: [
              {
                chainId: snapshot.chain.chainId,
                chainRef: snapshot.chain.chainRef,
                isUnlocked: snapshot.isUnlocked,
                meta: snapshot.meta,
              },
            ],
          },
        });
      },
      "broadcast_chain_changed_failed",
    );
  };

  const sendAccountsChanged = () => {
    for (const port of getConnectedPorts()) {
      const sessionId = getSessionIdForPort(port);
      const snapshot = findPortSnapshot(port);
      if (!sessionId || !snapshot) continue;

      void (async () => {
        try {
          const accounts = await getPermittedAccountsForPort(port, snapshot);
          const ok = postEnvelope(port, {
            channel: CHANNEL,
            sessionId,
            type: "event",
            payload: { event: PROVIDER_EVENTS.accountsChanged, params: [accounts] },
          });
          if (!ok) {
            dropStalePort(port, "broadcast_accounts_changed_failed");
          }
        } catch (error) {
          dropStalePort(port, "broadcast_accounts_changed_error", error);
        }
      })();
    }
  };

  const broadcastEvent = (event: string, params: unknown[]) => {
    broadcastSafe(
      (port) => !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        if (!sessionId) return true;
        return postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event, params },
        });
      },
      "broadcast_event_failed",
    );
  };

  const sendHandshakeAck = async (
    port: Runtime.Port,
    envelope: Extract<Envelope, { type: "handshake" }>,
    snapshot: ProviderBridgeSnapshot,
  ) => {
    syncPortContext(port, snapshot, portContexts, extensionOrigin);
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
          chainId: snapshot.chain.chainId,
          chainRef: snapshot.chain.chainRef,
          accounts,
          isUnlocked: snapshot.isUnlocked,
          meta: snapshot.meta,
        },
      },
      "send_handshake_failed",
    );
  };

  const broadcastDisconnectForPorts = (ports: Runtime.Port[]) => {
    const targetPortSet = new Set(ports);
    broadcastSafe(
      (port) => targetPortSet.has(port) && !!getSessionIdForPort(port),
      (port) => {
        const sessionId = getSessionIdForPort(port);
        if (!sessionId) return true;
        const portContext = portContexts.get(port);
        const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);
        const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
        const namespace = deriveRpcContextNamespace(rpcContext);
        const chainRef = rpcContext?.chainRef ?? null;
        const error = (rpcRegistry?.encodeErrorWithAdapters(
          arxError({ reason: ArxReasons.TransportDisconnected, message: "Disconnected" }),
          {
            surface: "dapp",
            namespace,
            chainRef,
            origin,
            method: PROVIDER_EVENTS.disconnect,
          },
        ) ?? ({ code: 4900, message: "Disconnected" } as const)) as JsonRpcError;
        rejectPendingWithDisconnect(port, error);
        const success = postEnvelope(port, {
          channel: CHANNEL,
          sessionId,
          type: "event",
          payload: { event: PROVIDER_EVENTS.disconnect, params: [error] },
        });
        if (success) {
          const eventOrigin = getPortOrigin(port, extensionOrigin);
          portLog("broadcastDisconnect", { origin: eventOrigin, errorCode: error.code, namespace });
        }
        return success;
      },
      "broadcast_disconnect_failed",
    );
  };

  const broadcastDisconnect = () => {
    broadcastDisconnectForPorts(getConnectedPorts());
  };

  const broadcastDisconnectForNamespaces = (namespaces: Iterable<string>) => {
    broadcastDisconnectForPorts(getPortsBoundToNamespaces(namespaces));
  };

  const handleRpcRequest = async (port: Runtime.Port, envelope: Extract<Envelope, { type: "request" }>) => {
    const { engine } = await getContext();
    const { id: rpcId, jsonrpc, method } = envelope.payload;
    const pendingRequestMap = getPendingRequestMap(port);
    pendingRequestMap.set(envelope.id, { rpcId, jsonrpc });

    const portContext = portContexts.get(port);
    const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
    const rpcContext = buildRpcContext(portContext, portContext?.chainRef ?? null);

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
          ...(rpcContext.namespace ? { namespace: rpcContext.namespace } : {}),
          ...(rpcContext.providerNamespace ? { providerNamespace: rpcContext.providerNamespace } : {}),
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
          namespace: deriveRpcContextNamespace(rpcContext),
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
        providerNamespace: null,
        meta: null,
        chainRef: null,
        chainId: null,
      });
    }

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake": {
          void (async () => {
            const namespace = parseHandshakeNamespace(envelope);
            if (!namespace) {
              dropStalePort(port, "handshake_missing_namespace");
              return;
            }

            // Allow session rotation: each connect attempt inpage may start a new sessionId.
            // If the session changes, drop any background-side pending tracking for the old session.
            const expectedSessionId = getSessionIdForPort(port);
            if (expectedSessionId && envelope.sessionId !== expectedSessionId) {
              clearPendingForPort(port);
              const portId = portIdByPort.get(port);
              if (portId) {
                try {
                  const { controllers } = await getContext();
                  await controllers.approvals.cancelByScope({
                    scope: {
                      transport: "provider",
                      origin: getPortOrigin(port, extensionOrigin),
                      portId,
                      sessionId: expectedSessionId,
                    },
                    reason: "session_lost",
                  });
                } catch (error) {
                  const eventOrigin = getPortOrigin(port, extensionOrigin);
                  portLog("failed to expire approvals on session rotation", {
                    origin: eventOrigin,
                    ...toErrorDetails(error),
                  });
                }
              }
            }

            await getContext();
            const snapshot = findProviderSnapshot(namespace);
            if (!snapshot) {
              dropStalePort(port, "handshake_snapshot_unavailable");
              return;
            }

            await sendHandshakeAck(port, envelope, snapshot);
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
            await controllers.approvals.cancelByScope({
              scope: {
                transport: "provider",
                origin: getPortOrigin(port, extensionOrigin),
                portId,
                sessionId,
              },
              reason: "session_lost",
            });
          } catch (error) {
            const eventOrigin = getPortOrigin(port, extensionOrigin);
            portLog("failed to expire approvals on disconnect", { origin: eventOrigin, ...toErrorDetails(error) });
          }
        })();
      }

      try {
        rejectPendingWithDisconnect(port);
      } catch (error) {
        const eventOrigin = getPortOrigin(port, extensionOrigin);
        portLog("disconnect cleanup error", { origin: eventOrigin, ...toErrorDetails(error) });
      } finally {
        connections.delete(port);
        pendingRequests.delete(port);
        portContexts.delete(port);
        sessionByPort.delete(port);
        portIdByPort.delete(port);
      }

      detachPortListeners(port);
      const disconnectOrigin = getPortOrigin(port, extensionOrigin);
      portLog("disconnect", { origin: disconnectOrigin, remaining: connections.size });
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    messageHandlers.set(port, handleMessage);
    disconnectHandlers.set(port, handleDisconnect);
  };

  const destroy = () => {
    for (const port of getConnectedPorts()) {
      dropStalePort(port, "destroy");
    }
    connections.clear();
    pendingRequests.clear();
    portContexts.clear();
    sessionByPort.clear();
    portIdByPort.clear();
    messageHandlers.clear();
    disconnectHandlers.clear();
  };

  return {
    handleConnect,
    listConnectedNamespaces,
    broadcastEvent,
    broadcastAccountsChanged: sendAccountsChanged,
    broadcastMetaChangedForNamespaces,
    broadcastChainChangedForNamespaces,
    broadcastDisconnect,
    broadcastDisconnectForNamespaces,
    destroy,
  };
};
