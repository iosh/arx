import { createLogger, extendLogger } from "@arx/core/logger";
import type { ProviderRuntimeAccess } from "@arx/core/runtime";
import { CHANNEL, type Envelope } from "@arx/provider/protocol";
import type { TransportResponse } from "@arx/provider/types";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { createProviderDisconnectFinalizer } from "./provider/disconnectFinalizer";
import { createProviderEventBroadcaster } from "./provider/eventBroadcaster";
import { createProviderHandshakeCoordinator } from "./provider/handshakeCoordinator";
import { createProviderRequestExecutor } from "./provider/requestExecutor";
import { createProviderSessionRegistry } from "./provider/sessionRegistry";
import type { PortContext, ProviderBridgeSnapshot } from "./types";

type PortRouterDeps = {
  extensionOrigin: string;
  getOrInitProviderAccess: () => Promise<ProviderRuntimeAccess>;
};

export const createPortRouter = ({ extensionOrigin, getOrInitProviderAccess }: PortRouterDeps) => {
  const messageHandlers = new Map<Runtime.Port, (message: unknown) => void>();
  const disconnectHandlers = new Map<Runtime.Port, () => void>();

  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "port");
  let providerAccess: ProviderRuntimeAccess | null = null;
  let providerAccessPromise: Promise<ProviderRuntimeAccess> | null = null;

  const getCachedProviderAccess = () => providerAccess;

  const loadProviderAccess = async () => {
    if (providerAccess) {
      return providerAccess;
    }

    if (providerAccessPromise) {
      return await providerAccessPromise;
    }

    providerAccessPromise = getOrInitProviderAccess()
      .then((access) => {
        providerAccess = access;
        return access;
      })
      .finally(() => {
        providerAccessPromise = null;
      });

    return await providerAccessPromise;
  };

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
      portLog("postMessage failed", { origin, envelopeType: envelope.type, error });
      return false;
    }
  };

  const listConnectedNamespaces = () => {
    return sessionRegistry.listConnectedNamespaces();
  };

  const readProviderSnapshot = (namespace: string): ProviderBridgeSnapshot | null => {
    const access = getCachedProviderAccess();
    if (!access) {
      return null;
    }

    try {
      return access.buildSnapshot(namespace);
    } catch (error) {
      portLog("failed to get provider snapshot", { namespace, error });
      return null;
    }
  };

  const findPortSnapshot = (port: Runtime.Port): ProviderBridgeSnapshot | null => {
    const namespace = sessionRegistry.readPortContext(port)?.providerNamespace;
    if (!namespace) return null;
    return readProviderSnapshot(namespace);
  };

  const getPortsBoundToNamespaces = (namespaces: Iterable<string>) => {
    return sessionRegistry.listPortsBoundToNamespaces(namespaces);
  };

  const syncPortContextsForPorts = (ports: Runtime.Port[]) => {
    syncAllPortContexts(ports, findPortSnapshot, portContextStore, extensionOrigin);
  };

  const cancelApprovalsForSession = async (port: Runtime.Port, sessionId: string, logReason: string) => {
    const portId = sessionRegistry.readPortId(port);
    if (!portId) {
      return;
    }

    const origin = getPortOrigin(port, extensionOrigin);

    try {
      const access = await loadProviderAccess();
      await access.cancelSessionApprovals({ origin, portId, sessionId });
    } catch (error) {
      portLog(logReason, { origin, error });
    }
  };

  const listPermittedAccountsForPort = async (port: Runtime.Port, snapshot: ProviderBridgeSnapshot) => {
    const origin = sessionRegistry.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);
    const chainRef = sessionRegistry.readPortContext(port)?.chainRef ?? snapshot.chain.chainRef;
    const access = await loadProviderAccess();

    return await access.listPermittedAccounts({
      origin,
      chainRef,
    });
  };

  const buildConnectionStateForPort = async (port: Runtime.Port, namespace: string) => {
    const origin = sessionRegistry.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);

    try {
      const access = await loadProviderAccess();
      return await access.buildConnectionState({ namespace, origin });
    } catch (error) {
      portLog("failed to build provider connection state", { namespace, origin, error });
      return null;
    }
  };

  const disconnectFinalizer = createProviderDisconnectFinalizer({
    extensionOrigin,
    getProviderAccess: getCachedProviderAccess,
    getSessionIdForPort,
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getPendingRequestMap: (port) => sessionRegistry.readPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    detachPortListeners,
    postEnvelope,
    removePortState: (port) => sessionRegistry.removePortState(port),
    cancelApprovalsForSession,
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
    getPermittedAccountsForPort: listPermittedAccountsForPort,
  });

  const getOrCreatePortId = (port: Runtime.Port) => {
    return sessionRegistry.allocatePortId(port);
  };

  const sendReply = (port: Runtime.Port, sessionId: string, id: string, payload: TransportResponse) => {
    const activeSessionId = getSessionIdForPort(port);
    if (!activeSessionId || activeSessionId !== sessionId) return;

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
    getProviderAccess: loadProviderAccess,
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getOrCreatePortId,
    getPendingRequestMap: (port) => sessionRegistry.openPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    sendReply,
  });

  const handshakeCoordinator = createProviderHandshakeCoordinator({
    getExpectedSessionId: getSessionIdForPort,
    clearSessionId: (port) => sessionRegistry.clearSessionId(port),
    writeSessionId: (port, sessionId) => sessionRegistry.writeSessionId(port, sessionId),
    getProviderConnectionState: buildConnectionStateForPort,
    syncPortContext: (port, snapshot) => syncPortContext(port, snapshot, portContextStore, extensionOrigin),
    finalizeSessionRotation: (port, sessionId) => disconnectFinalizer.finalizeSessionRotation(port, sessionId),
    postEnvelopeOrDrop,
    dropStalePort: disconnectFinalizer.dropStalePort,
  });

  const handleConnect = (port: Runtime.Port) => {
    if (port.name !== CHANNEL) return;

    const origin = getPortOrigin(port, extensionOrigin);
    sessionRegistry.registerConnectedPort(port, {
      origin,
      providerNamespace: null,
      chainRef: null,
    });
    portLog("connect", { origin, portName: port.name, total: sessionRegistry.countConnectedPorts() });

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake": {
          void handshakeCoordinator.handleHandshake(port, envelope);
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
    providerAccess = null;
    providerAccessPromise = null;
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
