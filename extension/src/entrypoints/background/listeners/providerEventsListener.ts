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
  let readProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot | null = () => null;

  const snapshotCache = new Map<string, ProviderBridgeSnapshot>();

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
      const providerAccess = await runtimeHost.getOrInitProviderAccess();
      if (disposed) return;
      readProviderSnapshot = (namespace: string) => {
        try {
          return providerAccess.buildSnapshot(namespace);
        } catch {
          return null;
        }
      };

      const publishAccountsState = () => {
        portRouter.broadcastAccountsChanged();
      };

      subscriptions.push(
        providerAccess.subscribeSessionUnlocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionUnlocked, [payload]);
          publishAccountsState();
        }),
      );

      subscriptions.push(
        providerAccess.subscribeSessionLocked((payload) => {
          portRouter.broadcastEvent(PROVIDER_EVENTS.sessionLocked, [payload]);
          publishAccountsState();
          portRouter.broadcastDisconnect();
        }),
      );

      subscriptions.push(
        providerAccess.subscribeNetworkStateChanged(() => {
          const namespaces = collectRelevantNamespaces(providerAccess.getActiveChainByNamespace());
          reconcileNamespaces(namespaces);
        }),
      );

      subscriptions.push(
        providerAccess.subscribeNetworkPreferencesChanged(({ next }) => {
          const namespaces = collectRelevantNamespaces(next.activeChainByNamespace);
          reconcileNamespaces(namespaces);
        }),
      );

      subscriptions.push(
        providerAccess.subscribeAccountsStateChanged(() => {
          publishAccountsState();
        }),
      );

      subscriptions.push(
        providerAccess.subscribePermissionsStateChanged(() => {
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
    readProviderSnapshot = () => null;
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
