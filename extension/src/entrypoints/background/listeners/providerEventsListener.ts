import { createLogger, extendLogger } from "@arx/core/logger";
import { PROVIDER_EVENTS } from "@arx/provider/protocol";
import type { createPortRouter } from "../portRouter";
import type { BackgroundRuntimeHost } from "../runtimeHost";
import type { ProviderBridgeSnapshot } from "../types";

type ProviderEventsOrchestratorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  portRouter: ReturnType<typeof createPortRouter>;
};

const sortEntries = (value: Record<string, string>) => {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
};

const areMetasEqual = (left: ProviderBridgeSnapshot["meta"], right: ProviderBridgeSnapshot["meta"]) => {
  if (left.supportedChains.length !== right.supportedChains.length) return false;
  if (left.supportedChains.some((chainRef, index) => chainRef !== right.supportedChains[index])) return false;

  const leftEntries = sortEntries(left.activeChainByNamespace);
  const rightEntries = sortEntries(right.activeChainByNamespace);
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(([namespace, chainRef], index) => {
    const [otherNamespace, otherChainRef] = rightEntries[index] ?? [];
    return namespace === otherNamespace && chainRef === otherChainRef;
  });
};

export const createProviderEventsListener = ({ runtimeHost, portRouter }: ProviderEventsOrchestratorDeps) => {
  const log = createLogger("bg:listener");
  const listenerLog = extendLogger(log, "providerEvents");
  const subscriptions: Array<() => void> = [];
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;
  let projectionQueue: Promise<void> = Promise.resolve();
  let readProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot | null = () => null;

  const snapshotCache = new Map<string, ProviderBridgeSnapshot>();

  const collectRelevantNamespaces = (activeChainByNamespace: Record<string, string>) => {
    return new Set([
      ...snapshotCache.keys(),
      ...portRouter.listConnectedNamespaces(),
      ...Object.keys(activeChainByNamespace),
    ]);
  };

  const enqueueProjection = (label: string, project: () => void | Promise<void>) => {
    projectionQueue = projectionQueue
      .then(async () => {
        if (disposed) return;
        await project();
      })
      .catch((error) => {
        listenerLog(`failed to project provider event: ${label}`, error);
      });

    return projectionQueue;
  };

  const reconcileNamespaces = async (namespaces: Iterable<string>) => {
    const chainChanged = new Set<string>();
    const metaChanged = new Set<string>();
    const disconnected = new Set<string>();

    for (const namespace of namespaces) {
      if (!namespace) continue;

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
      portRouter.broadcastChainChangedForNamespaces(chainChanged);
      await portRouter.broadcastAccountsChangedForNamespaces(chainChanged);
    }

    if (metaChanged.size > 0) {
      portRouter.broadcastMetaChangedForNamespaces(metaChanged);
    }

    if (disconnected.size > 0) {
      portRouter.broadcastDisconnectForNamespaces(disconnected);
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
    readProviderSnapshot = () => null;
    snapshotCache.clear();
    projectionQueue = Promise.resolve();
  };

  const start = () => {
    if (started || startTask) return;
    disposed = false;

    startTask = (async () => {
      try {
        const providerAccess = await runtimeHost.getOrInitProviderAccess();
        if (disposed) return;
        readProviderSnapshot = (namespace: string) => {
          try {
            return providerAccess.buildSnapshot(namespace);
          } catch {
            return null;
          }
        };

        const publishAccountsState = async (namespaces?: Iterable<string>) => {
          if (namespaces) {
            await portRouter.broadcastAccountsChangedForNamespaces(namespaces);
            return;
          }

          await portRouter.broadcastAccountsChanged();
        };

        subscriptions.push(
          providerAccess.subscribeSessionUnlocked((payload) => {
            void enqueueProjection("session_unlocked", async () => {
              portRouter.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
              await publishAccountsState();
            });
          }),
        );

        subscriptions.push(
          providerAccess.subscribeSessionLocked((payload) => {
            void enqueueProjection("session_locked", async () => {
              portRouter.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
              await publishAccountsState();
              portRouter.broadcastDisconnect();
            });
          }),
        );

        subscriptions.push(
          providerAccess.subscribeNetworkStateChanged(() => {
            void enqueueProjection("network_state_changed", async () => {
              const namespaces = collectRelevantNamespaces(providerAccess.getActiveChainByNamespace());
              await reconcileNamespaces(namespaces);
            });
          }),
        );

        subscriptions.push(
          providerAccess.subscribeNetworkPreferencesChanged(({ next }) => {
            void enqueueProjection("network_preferences_changed", async () => {
              const namespaces = collectRelevantNamespaces(next.activeChainByNamespace);
              await reconcileNamespaces(namespaces);
            });
          }),
        );

        subscriptions.push(
          providerAccess.subscribeAccountsStateChanged(() => {
            void enqueueProjection("accounts_state_changed", async () => {
              await publishAccountsState();
            });
          }),
        );

        subscriptions.push(
          providerAccess.subscribePermissionsStateChanged(() => {
            void enqueueProjection("permissions_state_changed", async () => {
              await publishAccountsState();
            });
          }),
        );

        started = true;
      } catch (error) {
        clearSubscriptions();
        resetDerivedState();
        listenerLog("failed to start provider events listener", error);
      }
    })().finally(() => {
      startTask = null;
    });
  };

  const destroy = () => {
    started = false;
    disposed = true;
    resetDerivedState();
    clearSubscriptions();
  };

  return { start, destroy };
};
