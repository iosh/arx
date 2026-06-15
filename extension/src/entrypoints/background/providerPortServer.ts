import type { CoreProviderApi } from "@arx/core/engine";
import { createLogger, extendLogger } from "@arx/core/logger";
import { CHANNEL, type Envelope, PROVIDER_EVENTS, type ProviderRpcResponse } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncPortContext } from "./portContext";
import { createProviderDisconnectFinalizer } from "./provider/disconnectFinalizer";
import { createProviderEventBroadcaster } from "./provider/eventBroadcaster";
import { createProviderHandshakeCoordinator } from "./provider/handshakeCoordinator";
import { createProviderPortConnections, type ProviderConnectionScope } from "./provider/providerPortConnections";
import { createProviderPortSessions } from "./provider/providerPortSessions";
import { createProviderRequestExecutor } from "./provider/requestExecutor";
import type { ProviderSessionContext } from "./types";

type ProviderPortServerDeps = {
  extensionOrigin: string;
  getOrInitProvider: () => Promise<CoreProviderApi>;
};

export type ProviderPortServer = {
  start(): void;
  handleConnect(port: Runtime.Port): void;
};

export const createProviderPortServer = ({
  extensionOrigin,
  getOrInitProvider,
}: ProviderPortServerDeps): ProviderPortServer => {
  const messageHandlers = new Map<Runtime.Port, (message: unknown) => void>();
  const disconnectHandlers = new Map<Runtime.Port, () => void>();
  const subscriptions: Array<() => void> = [];

  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "providerPort");

  let provider: CoreProviderApi | null = null;
  let providerPromise: Promise<CoreProviderApi> | null = null;
  let started = false;
  let startTask: Promise<void> | null = null;

  const createPortId = () => globalThis.crypto.randomUUID();
  const providerPortSessions = createProviderPortSessions({ createPortId });
  const providerPortConnections = createProviderPortConnections();
  const portContextStore = {
    readPortContext: (port: Runtime.Port) => providerPortSessions.readPortContext(port),
    writePortContext: (port: Runtime.Port, context: ProviderSessionContext) =>
      providerPortSessions.writePortContext(port, context),
  };

  const getCachedProvider = () => provider;

  const loadProvider = async (): Promise<CoreProviderApi> => {
    if (provider) {
      return provider;
    }
    if (providerPromise) {
      return await providerPromise;
    }

    providerPromise = getOrInitProvider()
      .then((activeProvider) => {
        provider = activeProvider;
        return activeProvider;
      })
      .finally(() => {
        providerPromise = null;
      });

    return await providerPromise;
  };

  const detachPortListeners = (port: Runtime.Port) => {
    const onMessage = messageHandlers.get(port);
    if (onMessage) {
      try {
        port.onMessage.removeListener(onMessage);
      } catch {
        // ignore cleanup failures
      }
      messageHandlers.delete(port);
    }

    const onDisconnect = disconnectHandlers.get(port);
    if (onDisconnect) {
      try {
        port.onDisconnect.removeListener(onDisconnect);
      } catch {
        // ignore cleanup failures
      }
      disconnectHandlers.delete(port);
    }
  };

  const postEnvelope = (port: Runtime.Port, envelope: Envelope) => {
    try {
      port.postMessage(envelope);
      return true;
    } catch (error) {
      const origin = getPortOrigin(port, extensionOrigin);
      portLog("postMessage failed", {
        error,
        envelopeType: envelope.type,
        origin,
      });
      return false;
    }
  };

  const disconnectConnectionScope = (scope: ProviderConnectionScope) => {
    const activeProvider = getCachedProvider();
    if (!activeProvider) {
      return;
    }

    try {
      activeProvider.deactivateConnectionScope(scope);
    } catch (error) {
      portLog("failed to disconnect provider connection scope", {
        error,
        namespace: scope.namespace,
        origin: scope.origin,
      });
    }
  };

  const detachPortFromConnection = (port: Runtime.Port) => {
    const released = providerPortConnections.detachPort(port);
    if (released?.scopeBecameInactive) {
      disconnectConnectionScope(released.scope);
    }
    return released;
  };

  const cancelRequestScopeForPort = async (port: Runtime.Port, sessionId: string, logReason: string) => {
    const portId = providerPortSessions.readPortId(port);
    if (!portId) {
      return;
    }

    const origin = providerPortSessions.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);

    try {
      const activeProvider = await loadProvider();
      await activeProvider.cancelRequestScope({
        transport: "provider",
        origin,
        portId,
        sessionId,
      });
    } catch (error) {
      portLog(logReason, { error, origin, sessionId });
    }
  };

  const getConnectionStateForPort = async (port: Runtime.Port, namespace: string) => {
    const origin = providerPortSessions.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);
    const activeProvider = await loadProvider();
    if (!providerPortSessions.hasConnectedPort(port)) {
      return null;
    }

    const scope = { origin, namespace };
    const change = providerPortConnections.attachPortToConnection(port, scope);

    if (change.previousScope?.scopeBecameInactive) {
      disconnectConnectionScope(change.previousScope.scope);
    }

    const connectionState = change.scopeBecameActive
      ? await activeProvider.activateConnectionScope(scope)
      : await activeProvider.getConnectionState(scope);
    if (!providerPortSessions.hasConnectedPort(port) || !providerPortConnections.hasPortInScope(port, scope)) {
      if (change.scopeBecameActive && !providerPortConnections.hasPortsForScope(scope)) {
        disconnectConnectionScope(scope);
      }
      return null;
    }

    return connectionState;
  };

  const disconnectFinalizer = createProviderDisconnectFinalizer({
    extensionOrigin,
    getProvider: getCachedProvider,
    getSessionIdForPort: (port) => providerPortSessions.readSessionId(port),
    getPendingRequestMap: (port) => providerPortSessions.readPendingRequestMap(port),
    clearPendingForPort: (port) => providerPortSessions.dropPendingRequests(port),
    detachPortListeners,
    postEnvelope,
    detachPortFromConnection,
    removePortState: (port) => providerPortSessions.removePortState(port),
    cancelRequestScope: cancelRequestScopeForPort,
    portLog,
  });

  const postEnvelopeOrDrop = (port: Runtime.Port, envelope: Envelope, reason: string) => {
    const delivered = postEnvelope(port, envelope);
    if (!delivered) {
      disconnectFinalizer.dropStalePort(port, reason);
    }
    return delivered;
  };

  const eventBroadcaster = createProviderEventBroadcaster({
    getConnectedPorts: () => providerPortSessions.listConnectedPorts(),
    getSessionIdForPort: (port) => providerPortSessions.readSessionId(port),
    getPortsForConnectionScopes: (scopes) => providerPortConnections.listPortsForConnectionScopes(scopes),
    postEnvelope,
    dropStalePort: disconnectFinalizer.dropStalePort,
  });

  const sendReply = (port: Runtime.Port, sessionId: string, id: string, payload: ProviderRpcResponse) => {
    const activeSessionId = providerPortSessions.readSessionId(port);
    if (!activeSessionId || activeSessionId !== sessionId) {
      return;
    }

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
    getProvider: loadProvider,
    getSessionContext: (port) => {
      const sessionContext = providerPortSessions.readSessionContext(port);
      if (!sessionContext) {
        throw new Error("Provider request reached executor before session context was established.");
      }
      return sessionContext;
    },
    getOrCreatePortId: (port) => providerPortSessions.allocatePortId(port),
    getPendingRequestMap: (port) => providerPortSessions.openPendingRequestMap(port),
    clearPendingForPort: (port) => providerPortSessions.dropPendingRequests(port),
    sendReply,
  });

  const handshakeCoordinator = createProviderHandshakeCoordinator({
    getExpectedSessionId: (port) => providerPortSessions.readSessionId(port),
    clearSessionId: (port) => providerPortSessions.clearSessionId(port),
    writeSessionId: (port, sessionId) => providerPortSessions.writeSessionId(port, sessionId),
    getProviderConnectionState: async (port, namespace) => {
      const connectionState = await getConnectionStateForPort(port, namespace);
      if (!connectionState) {
        return null;
      }
      return {
        snapshot: connectionState.snapshot,
        accounts: connectionState.accounts,
      };
    },
    syncPortContext: (port, snapshot) => syncPortContext(port, snapshot, portContextStore, extensionOrigin),
    finalizeSessionRotation: (port, sessionId) => disconnectFinalizer.finalizeSessionRotation(port, sessionId),
    postEnvelopeOrDrop,
    dropStalePort: disconnectFinalizer.dropStalePort,
  });

  const clearSubscriptions = () => {
    const activeSubscriptions = [...subscriptions];
    subscriptions.length = 0;

    for (const unsubscribe of activeSubscriptions) {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    }
  };

  const start = () => {
    if (started || startTask) {
      return;
    }

    startTask = (async () => {
      try {
        const activeProvider = await loadProvider();

        subscriptions.push(
          activeProvider.subscribeSessionUnlocked((payload) => {
            eventBroadcaster.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
          }),
        );

        subscriptions.push(
          activeProvider.subscribeSessionLocked((payload) => {
            eventBroadcaster.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
          }),
        );

        subscriptions.push(
          activeProvider.subscribeConnectionStateChanged((change) => {
            eventBroadcaster.broadcastConnectionStateChange(change.scope, change.next, change.changed);
          }),
        );

        started = true;
      } catch (error) {
        clearSubscriptions();
        portLog("failed to start provider port server", { error });
      } finally {
        startTask = null;
      }
    })();
  };

  const handleConnect = (port: Runtime.Port) => {
    if (port.name !== CHANNEL) {
      return;
    }

    start();

    const origin = getPortOrigin(port, extensionOrigin);
    providerPortSessions.registerConnectedPort(port, {
      origin,
    });
    portLog("connect", { origin, portName: port.name, total: providerPortSessions.countConnectedPorts() });

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) {
        return;
      }

      switch (envelope.type) {
        case "handshake": {
          void handshakeCoordinator.handleHandshake(port, envelope);
          break;
        }

        case "request": {
          const expectedSessionId = providerPortSessions.readSessionId(port);
          if (!expectedSessionId) {
            disconnectFinalizer.dropStalePort(port, "request_without_handshake");
            return;
          }
          if (envelope.sessionId !== expectedSessionId) {
            return;
          }
          if (!providerPortSessions.readSessionContext(port)) {
            disconnectFinalizer.dropStalePort(port, "request_without_session_context");
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

  return {
    start,
    handleConnect,
  };
};
