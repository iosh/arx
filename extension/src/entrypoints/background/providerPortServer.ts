import type { WalletProvider } from "@arx/core/engine";
import { createLogger, extendLogger } from "@arx/core/logger";
import { CHANNEL, type Envelope, PROVIDER_EVENTS, type ProviderRpcResponse } from "@arx/provider/protocol";
import type { Runtime } from "webextension-polyfill";
import { getPortOrigin } from "./origin";
import { syncAllPortContexts, syncPortContext } from "./portContext";
import { createProviderBindingRegistry, type ProviderBinding } from "./provider/bindingRegistry";
import { createProviderDisconnectFinalizer } from "./provider/disconnectFinalizer";
import { createProviderEventBroadcaster } from "./provider/eventBroadcaster";
import { createProviderHandshakeCoordinator } from "./provider/handshakeCoordinator";
import { createProviderRequestExecutor } from "./provider/requestExecutor";
import { createProviderSessionRegistry } from "./provider/sessionRegistry";
import type { PortContext, ProviderBridgeSnapshot } from "./types";

type ProviderPortServerDeps = {
  extensionOrigin: string;
  getOrInitProvider: () => Promise<WalletProvider>;
};

export type ProviderPortServer = {
  start(): void;
  handleConnect(port: Runtime.Port): void;
  destroy(): void;
};

const sortEntries = (value: Record<string, string>) => {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
};

const areMetasEqual = (left: ProviderBridgeSnapshot["meta"], right: ProviderBridgeSnapshot["meta"]) => {
  if (left.supportedChains.length !== right.supportedChains.length) {
    return false;
  }
  if (left.supportedChains.some((chainRef, index) => chainRef !== right.supportedChains[index])) {
    return false;
  }

  const leftEntries = sortEntries(left.activeChainByNamespace);
  const rightEntries = sortEntries(right.activeChainByNamespace);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([namespace, chainRef], index) => {
    const [otherNamespace, otherChainRef] = rightEntries[index] ?? [];
    return namespace === otherNamespace && chainRef === otherChainRef;
  });
};

export const createProviderPortServer = ({
  extensionOrigin,
  getOrInitProvider,
}: ProviderPortServerDeps): ProviderPortServer => {
  const messageHandlers = new Map<Runtime.Port, (message: unknown) => void>();
  const disconnectHandlers = new Map<Runtime.Port, () => void>();
  const subscriptions: Array<() => void> = [];
  const snapshotCache = new Map<string, ProviderBridgeSnapshot>();

  const runtimeLog = createLogger("bg:runtime");
  const portLog = extendLogger(runtimeLog, "providerPort");

  let provider: WalletProvider | null = null;
  let providerPromise: Promise<WalletProvider> | null = null;
  let projectionQueue: Promise<void> = Promise.resolve();
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;
  let lifecycleGeneration = 0;

  const createPortId = () => globalThis.crypto.randomUUID();
  const sessionRegistry = createProviderSessionRegistry({ createPortId });
  const bindingRegistry = createProviderBindingRegistry();
  const portContextStore = {
    readPortContext: (port: Runtime.Port) => sessionRegistry.readPortContext(port),
    writePortContext: (port: Runtime.Port, context: PortContext) => sessionRegistry.writePortContext(port, context),
  };

  const getCachedProvider = () => provider;

  const loadProvider = async (): Promise<WalletProvider> => {
    if (provider) {
      return provider;
    }
    if (providerPromise) {
      return await providerPromise;
    }

    const providerGeneration = lifecycleGeneration;

    providerPromise = getOrInitProvider()
      .then((activeProvider) => {
        if (providerGeneration !== lifecycleGeneration) {
          throw new Error("provider port server was reset during provider bootstrap");
        }

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

  const readProviderSnapshot = (namespace: string): ProviderBridgeSnapshot | null => {
    const activeProvider = getCachedProvider();
    if (!activeProvider) {
      return null;
    }

    try {
      return activeProvider.buildSnapshot(namespace);
    } catch (error) {
      portLog("failed to build provider snapshot", { error, namespace });
      return null;
    }
  };

  const findPortSnapshot = (port: Runtime.Port): ProviderBridgeSnapshot | null => {
    const namespace = sessionRegistry.readPortContext(port)?.providerNamespace;
    if (!namespace) {
      return null;
    }

    return readProviderSnapshot(namespace);
  };

  const syncPortContextsForPorts = (ports: Runtime.Port[]) => {
    syncAllPortContexts(ports, findPortSnapshot, portContextStore, extensionOrigin);
  };

  const disconnectBinding = (binding: ProviderBinding) => {
    const activeProvider = getCachedProvider();
    if (!activeProvider) {
      return;
    }

    try {
      activeProvider.disconnect(binding);
    } catch (error) {
      portLog("failed to disconnect provider binding", {
        error,
        namespace: binding.namespace,
        origin: binding.origin,
      });
    }
  };

  const releaseBinding = (port: Runtime.Port) => {
    const released = bindingRegistry.releasePort(port);
    if (released?.bindingBecameInactive) {
      disconnectBinding(released.binding);
    }
    return released;
  };

  const cancelApprovalsForSession = async (port: Runtime.Port, sessionId: string, logReason: string) => {
    const portId = sessionRegistry.readPortId(port);
    if (!portId) {
      return;
    }

    const origin = sessionRegistry.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);

    try {
      const activeProvider = await loadProvider();
      await activeProvider.cancelSessionApprovals({ origin, portId, sessionId });
    } catch (error) {
      portLog(logReason, { error, origin, sessionId });
    }
  };

  const buildConnectionProjectionForPort = async (port: Runtime.Port, namespace: string) => {
    const origin = sessionRegistry.readPortContext(port)?.origin ?? getPortOrigin(port, extensionOrigin);
    const activeProvider = await loadProvider();
    const mutation = bindingRegistry.bindPort(port, { origin, namespace });

    if (mutation.previousBinding?.bindingBecameInactive) {
      disconnectBinding(mutation.previousBinding.binding);
    }

    return mutation.bindingBecameActive
      ? activeProvider.connect({ origin, namespace })
      : activeProvider.buildConnectionProjection({ origin, namespace });
  };

  const disconnectFinalizer = createProviderDisconnectFinalizer({
    extensionOrigin,
    getProvider: getCachedProvider,
    getSessionIdForPort: (port) => sessionRegistry.readSessionId(port),
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getPendingRequestMap: (port) => sessionRegistry.readPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    detachPortListeners,
    postEnvelope,
    releaseBinding,
    removePortState: (port) => sessionRegistry.removePortState(port),
    cancelApprovalsForSession,
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
    getConnectedPorts: () => sessionRegistry.listConnectedPorts(),
    getSessionIdForPort: (port) => sessionRegistry.readSessionId(port),
    getPortsBoundToNamespaces: (namespaces) => bindingRegistry.listPortsBoundToNamespaces(namespaces),
    findPortSnapshot,
    syncPortContextsForPorts,
    postEnvelope,
    dropStalePort: disconnectFinalizer.dropStalePort,
    getPermittedAccountsForPort: async (port) => {
      const activeProvider = await loadProvider();
      const portContext = sessionRegistry.readPortContext(port);
      const namespace = portContext?.providerNamespace;
      if (!namespace) {
        return [];
      }

      const origin = portContext?.origin ?? getPortOrigin(port, extensionOrigin);
      return activeProvider.buildConnectionProjection({ origin, namespace }).accounts;
    },
  });

  const sendReply = (port: Runtime.Port, sessionId: string, id: string, payload: ProviderRpcResponse) => {
    const activeSessionId = sessionRegistry.readSessionId(port);
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
    extensionOrigin,
    getProvider: loadProvider,
    getPortContext: (port) => sessionRegistry.readPortContext(port),
    getOrCreatePortId: (port) => sessionRegistry.allocatePortId(port),
    getPendingRequestMap: (port) => sessionRegistry.openPendingRequestMap(port),
    clearPendingForPort: (port) => sessionRegistry.dropPendingRequests(port),
    sendReply,
  });

  const handshakeCoordinator = createProviderHandshakeCoordinator({
    getExpectedSessionId: (port) => sessionRegistry.readSessionId(port),
    clearSessionId: (port) => sessionRegistry.clearSessionId(port),
    writeSessionId: (port, sessionId) => sessionRegistry.writeSessionId(port, sessionId),
    getProviderConnectionState: async (port, namespace) => {
      const projection = await buildConnectionProjectionForPort(port, namespace);
      return {
        snapshot: projection.snapshot,
        accounts: projection.accounts,
      };
    },
    syncPortContext: (port, snapshot) => syncPortContext(port, snapshot, portContextStore, extensionOrigin),
    finalizeSessionRotation: (port, sessionId) => disconnectFinalizer.finalizeSessionRotation(port, sessionId),
    postEnvelopeOrDrop,
    dropStalePort: disconnectFinalizer.dropStalePort,
  });

  const collectRelevantNamespaces = () => {
    return new Set([...snapshotCache.keys(), ...bindingRegistry.listActiveNamespaces()]);
  };

  const enqueueProjection = (label: string, project: () => void | Promise<void>) => {
    projectionQueue = projectionQueue
      .then(async () => {
        if (disposed) {
          return;
        }

        await project();
      })
      .catch((error) => {
        portLog(`failed to project provider event: ${label}`, { error });
      });

    return projectionQueue;
  };

  const reconcileNamespaces = async (namespaces: Iterable<string>) => {
    const chainChanged = new Set<string>();
    const metaChanged = new Set<string>();
    const disconnected = new Set<string>();

    for (const namespace of namespaces) {
      if (!namespace) {
        continue;
      }

      const previous = snapshotCache.get(namespace) ?? null;
      const next = readProviderSnapshot(namespace);
      if (!next) {
        if (previous) {
          snapshotCache.delete(namespace);
          disconnected.add(namespace);
        }
        continue;
      }

      snapshotCache.set(namespace, next);

      if (
        !previous ||
        previous.chain.chainId !== next.chain.chainId ||
        previous.chain.chainRef !== next.chain.chainRef
      ) {
        chainChanged.add(namespace);
      }

      if (!previous || !areMetasEqual(previous.meta, next.meta)) {
        metaChanged.add(namespace);
      }
    }

    if (chainChanged.size > 0) {
      eventBroadcaster.broadcastChainChangedForNamespaces(chainChanged);
      await eventBroadcaster.broadcastAccountsChangedForNamespaces(chainChanged);
    }

    if (metaChanged.size > 0) {
      eventBroadcaster.broadcastMetaChangedForNamespaces(metaChanged);
    }

    if (disconnected.size > 0) {
      disconnectFinalizer.broadcastDisconnectForPorts(bindingRegistry.listPortsBoundToNamespaces(disconnected));
    }
  };

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

  const resetDerivedState = () => {
    snapshotCache.clear();
    projectionQueue = Promise.resolve();
  };

  const start = () => {
    if (started || startTask) {
      return;
    }

    disposed = false;
    const startGeneration = lifecycleGeneration;

    startTask = (async () => {
      try {
        const activeProvider = await loadProvider();
        if (disposed || startGeneration !== lifecycleGeneration) {
          return;
        }

        const publishAccountsState = async (namespaces?: Iterable<string>) => {
          if (namespaces) {
            await eventBroadcaster.broadcastAccountsChangedForNamespaces(namespaces);
            return;
          }

          await eventBroadcaster.broadcastAccountsChanged();
        };

        subscriptions.push(
          activeProvider.subscribeSessionUnlocked((payload) => {
            void enqueueProjection("session_unlocked", async () => {
              eventBroadcaster.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
              await publishAccountsState();
            });
          }),
        );

        subscriptions.push(
          activeProvider.subscribeSessionLocked((payload) => {
            void enqueueProjection("session_locked", async () => {
              eventBroadcaster.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
              await publishAccountsState();
            });
          }),
        );

        subscriptions.push(
          activeProvider.subscribeNetworkStateChanged(() => {
            void enqueueProjection("network_state_changed", async () => {
              await reconcileNamespaces(collectRelevantNamespaces());
            });
          }),
        );

        subscriptions.push(
          activeProvider.subscribeNetworkPreferencesChanged(() => {
            void enqueueProjection("network_preferences_changed", async () => {
              await reconcileNamespaces(collectRelevantNamespaces());
            });
          }),
        );

        subscriptions.push(
          activeProvider.subscribeAccountsStateChanged(() => {
            void enqueueProjection("accounts_state_changed", async () => {
              await publishAccountsState();
            });
          }),
        );

        subscriptions.push(
          activeProvider.subscribePermissionsStateChanged(() => {
            void enqueueProjection("permissions_state_changed", async () => {
              await publishAccountsState();
            });
          }),
        );

        started = true;
      } catch (error) {
        clearSubscriptions();
        resetDerivedState();
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

    const origin = getPortOrigin(port, extensionOrigin);
    sessionRegistry.registerConnectedPort(port, {
      origin,
      providerNamespace: null,
    });
    portLog("connect", { origin, portName: port.name, total: sessionRegistry.countConnectedPorts() });

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
          const expectedSessionId = sessionRegistry.readSessionId(port);
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

  const destroy = () => {
    lifecycleGeneration += 1;
    started = false;
    disposed = true;

    clearSubscriptions();
    resetDerivedState();

    for (const port of sessionRegistry.listConnectedPorts()) {
      disconnectFinalizer.dropStalePort(port, "destroy");
    }

    sessionRegistry.clearAllState();
    bindingRegistry.clearAllState();
    messageHandlers.clear();
    disconnectHandlers.clear();
    provider = null;
    providerPromise = null;
  };

  return {
    start,
    handleConnect,
    destroy,
  };
};
