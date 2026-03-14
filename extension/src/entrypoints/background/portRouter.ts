import { createLogger, extendLogger } from "@arx/core/logger";
import type { RpcRegistry } from "@arx/core/rpc";
import { CHANNEL, type Envelope, PROTOCOL_VERSION } from "@arx/provider/protocol";
import type { TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { createProviderDisconnectFinalizer } from "./provider/disconnectFinalizer";
import { createProviderEventBroadcaster } from "./provider/eventBroadcaster";
import { createProviderRequestExecutor } from "./provider/requestExecutor";
import { createProviderSessionRegistry } from "./provider/sessionRegistry";
import type { BackgroundContext } from "./runtimeHost";
import type { PortContext, ProviderBridgeSnapshot } from "./types";

type PortRouterDeps = {
  extensionOrigin: string;
  getOrInitContext: () => Promise<BackgroundContext>;
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot;
};

const parseHandshakeNamespace = (envelope: Extract<Envelope, { type: "handshake" }>) => {
  const namespace = envelope.payload.namespace.trim();
  return namespace.length > 0 ? namespace : null;
};

const toErrorDetails = (error: unknown): Record<string, string> => {
  if (!error) return {};
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { error: String(error) };
};

export const createPortRouter = ({ extensionOrigin, getOrInitContext, getProviderSnapshot }: PortRouterDeps) => {
  const messageHandlers = new Map<Runtime.Port, (message: unknown) => void>();
  const disconnectHandlers = new Map<Runtime.Port, () => void>();

  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "port");
  let rpcRegistry: RpcRegistry | null = null;

  const getContext = async () => {
    const ctx = await getOrInitContext();
    rpcRegistry = ctx.runtime.rpc.registry;
    return ctx;
  };

  const getRpcRegistry = () => rpcRegistry;

  const createPortId = (): string => {
    return globalThis.crypto.randomUUID();
  };

  const sessionRegistry = createProviderSessionRegistry({ createPortId });
  const portContextStore = {
    readPortContext: (port: Runtime.Port) => sessionRegistry.readPortContext(port),
    writePortContext: (port: Runtime.Port, context: PortContext) => sessionRegistry.writePortContext(port, context),
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

  const getConnectedPorts = () => {
    return sessionRegistry.listConnectedPorts();
  };

  const getSessionIdForPort = (port: Runtime.Port) => sessionRegistry.readSessionId(port);

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

  const listConnectedNamespaces = () => {
    return sessionRegistry.listConnectedNamespaces();
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
    const namespace = sessionRegistry.readPortContext(port)?.providerNamespace;
    if (!namespace) return null;
    return findProviderSnapshot(namespace);
  };

  const getPortsBoundToNamespaces = (namespaces: Iterable<string>) => {
    return sessionRegistry.listPortsBoundToNamespaces(namespaces);
  };

  const syncPortContextsForPorts = (ports: Runtime.Port[]) => {
    syncAllPortContexts(ports, findPortSnapshot, portContextStore, extensionOrigin);
  };

  const getPermittedAccountsForPort = async (
    port: Runtime.Port,
    snapshot: ProviderBridgeSnapshot,
  ): Promise<string[]> => {
    if (!snapshot.isUnlocked) return [];

    const origin = getPortOrigin(port, extensionOrigin);
    if (origin === "unknown://") return [];

    const { controllers, permissionViews } = await getContext();
    const portContext = sessionRegistry.readPortContext(port);
    const chainRef = portContext?.chainRef ?? snapshot.chain.chainRef;
    return permissionViews
      .listPermittedAccounts(origin, { chainRef })
      .map((account) =>
        controllers.chainAddressCodecs.formatAddress({ chainRef, canonical: account.canonicalAddress }),
      );
  };

  const disconnectFinalizer = createProviderDisconnectFinalizer({
    extensionOrigin,
    getContext,
    getRpcRegistry,
    getSessionIdForPort,
    getPortId: (port) => sessionRegistry.readPortId(port),
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getPendingRequestMap: (port) => sessionRegistry.readPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    detachPortListeners,
    postEnvelope,
    removePortState: (port) => sessionRegistry.removePortState(port),
    portLog,
  });

  const postEnvelopeOrDrop = (port: Runtime.Port, envelope: Envelope, reason: string): boolean => {
    const ok = postEnvelope(port, envelope);
    if (!ok) {
      disconnectFinalizer.dropStalePort(port, reason);
    }
    return ok;
  };

  const eventBroadcaster = createProviderEventBroadcaster({
    getConnectedPorts,
    getSessionIdForPort,
    getPortsBoundToNamespaces,
    findPortSnapshot,
    syncPortContextsForPorts,
    postEnvelope,
    dropStalePort: disconnectFinalizer.dropStalePort,
    getPermittedAccountsForPort,
  });

  const getOrCreatePortId = (port: Runtime.Port) => {
    return sessionRegistry.allocatePortId(port);
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

  const requestExecutor = createProviderRequestExecutor({
    extensionOrigin,
    getContext,
    getRpcRegistry,
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getOrCreatePortId,
    getPendingRequestMap: (port) => sessionRegistry.openPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    sendReply,
  });

  const sendHandshakeAck = async (
    port: Runtime.Port,
    envelope: Extract<Envelope, { type: "handshake" }>,
    snapshot: ProviderBridgeSnapshot,
  ) => {
    syncPortContext(port, snapshot, portContextStore, extensionOrigin);
    sessionRegistry.writeSessionId(port, envelope.sessionId);

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

  const handleConnect = (port: Runtime.Port) => {
    if (port.name !== CHANNEL) return;

    const origin = getPortOrigin(port, extensionOrigin);
    sessionRegistry.registerConnectedPort(port, {
      origin,
      providerNamespace: null,
      meta: null,
      chainRef: null,
      chainId: null,
    });
    portLog("connect", { origin, portName: port.name, total: sessionRegistry.countConnectedPorts() });

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake": {
          void (async () => {
            const namespace = parseHandshakeNamespace(envelope);
            if (!namespace) {
              disconnectFinalizer.dropStalePort(port, "handshake_missing_namespace");
              return;
            }

            const expectedSessionId = getSessionIdForPort(port);
            if (expectedSessionId && envelope.sessionId !== expectedSessionId) {
              sessionRegistry.dropPendingRequests(port);
              const portId = sessionRegistry.readPortId(port);
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
              disconnectFinalizer.dropStalePort(port, "handshake_snapshot_unavailable");
              return;
            }

            await sendHandshakeAck(port, envelope, snapshot);
          })();
          break;
        }

        case "request": {
          const expectedSessionId = getSessionIdForPort(port);
          if (!expectedSessionId) {
            disconnectFinalizer.dropStalePort(port, "request_without_handshake");
            return;
          }
          if (envelope.sessionId !== expectedSessionId) {
            return;
          }
          void requestExecutor.handleRpcRequest(port, envelope);
          break;
        }

        default:
          break;
      }
    };

    const handleDisconnect = () => {
      disconnectFinalizer.finalizePortDisconnect(port);
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    messageHandlers.set(port, handleMessage);
    disconnectHandlers.set(port, handleDisconnect);
  };

  const broadcastDisconnect = () => {
    disconnectFinalizer.broadcastDisconnectForPorts(getConnectedPorts());
  };

  const broadcastDisconnectForNamespaces = (namespaces: Iterable<string>) => {
    disconnectFinalizer.broadcastDisconnectForPorts(getPortsBoundToNamespaces(namespaces));
  };

  const destroy = () => {
    for (const port of getConnectedPorts()) {
      disconnectFinalizer.dropStalePort(port, "destroy");
    }
    sessionRegistry.clearAllState();
    messageHandlers.clear();
    disconnectHandlers.clear();
  };

  return {
    handleConnect,
    listConnectedNamespaces,
    broadcastEvent: eventBroadcaster.broadcastEvent,
    broadcastAccountsChanged: eventBroadcaster.broadcastAccountsChanged,
    broadcastMetaChangedForNamespaces: eventBroadcaster.broadcastMetaChangedForNamespaces,
    broadcastChainChangedForNamespaces: eventBroadcaster.broadcastChainChangedForNamespaces,
    broadcastDisconnect,
    broadcastDisconnectForNamespaces,
    destroy,
  };
};
