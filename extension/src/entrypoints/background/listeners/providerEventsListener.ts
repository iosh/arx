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
  const subscriptions: Array<() => void> = [];
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;

  const snapshotCache = new Map<string, ProviderBridgeSnapshot>();

  const getSnapshot = (namespace: string) => {
    try {
      return runtimeHost.getProviderSnapshot(namespace);
    } catch {
      return null;
    }
  };

  const collectRelevantNamespaces = (activeChainByNamespace: Record<string, string>) => {
    return new Set([
      ...snapshotCache.keys(),
      ...portRouter.listConnectedNamespaces(),
      ...Object.keys(activeChainByNamespace),
    ]);
  };

  const reconcileNamespaces = (namespaces: Iterable<string>) => {
    const chainChanged = new Set<string>();
    const metaChanged = new Set<string>();
    const disconnected = new Set<string>();

    for (const namespace of namespaces) {
      if (!namespace) continue;

      const previous = snapshotCache.get(namespace) ?? null;
      const next = getSnapshot(namespace);

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
        previous.chain.chainRef !== next.chain.chainRef ||
        previous.isUnlocked !== next.isUnlocked
      ) {
        chainChanged.add(namespace);
      }

      if (!previous || !areMetasEqual(previous.meta, next.meta)) {
        metaChanged.add(namespace);
      }
    }

    if (metaChanged.size > 0) {
      portRouter.broadcastMetaChangedForNamespaces(metaChanged);
    }

    if (chainChanged.size > 0) {
      portRouter.broadcastChainChangedForNamespaces(chainChanged);
    }

    if (disconnected.size > 0) {
      portRouter.broadcastDisconnectForNamespaces(disconnected);
    }
  };

  const start = () => {
    if (started) return;
    started = true;
    disposed = false;

    if (startTask) return;

    startTask = (async () => {
      const { controllers, session, networkPreferences } = await runtimeHost.getOrInitContext();
      if (disposed) return;

      const publishAccountsState = () => {
        portRouter.broadcastAccountsChanged();
      };

      subscriptions.push(
        session.unlock.onUnlocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
          publishAccountsState();
        }),
      );

      subscriptions.push(
        session.unlock.onLocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
          publishAccountsState();
          portRouter.broadcastDisconnect();
        }),
      );

      subscriptions.push(
        controllers.network.onStateChanged(() => {
          const namespaces = collectRelevantNamespaces(networkPreferences.getActiveChainByNamespace());
          reconcileNamespaces(namespaces);
        }),
      );

      subscriptions.push(
        networkPreferences.subscribeChanged(({ next }) => {
          const namespaces = collectRelevantNamespaces(next.activeChainByNamespace);
          reconcileNamespaces(namespaces);
        }),
      );

      subscriptions.push(
        controllers.accounts.onStateChanged(() => {
          publishAccountsState();
        }),
      );

      subscriptions.push(
        controllers.permissions.onPermissionsChanged(() => {
          publishAccountsState();
        }),
      );
    })().finally(() => {
      startTask = null;
    });
  };

  const destroy = () => {
    started = false;
    disposed = true;
    snapshotCache.clear();
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    });
  };

  return { start, destroy };
};
