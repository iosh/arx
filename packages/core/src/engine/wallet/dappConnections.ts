import type { ChainRef } from "../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { ProviderRuntimeConnectionQuery } from "../../runtime/provider/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import { createSignal, type StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type {
  DappConnectionProjection,
  DappConnectionRecord,
  DappConnectionsState,
  WalletDappConnections,
} from "../types.js";
import {
  buildProviderConnectionState,
  buildProviderSnapshot,
  listFormattedPermittedAccounts,
} from "./providerProjection.js";

type DappConnectionsRecord = {
  origin: string;
  namespace: string;
  connectedAt: number;
  updatedAt: number;
};

// Live dApp connections tracked only in memory.
export const createWalletDappConnections = (deps: {
  now?: () => number;
  sessionStatus: Pick<SessionStatusService, "getStatus">;
  permissionViews: Pick<PermissionViewsService, "listPermittedAccounts">;
  chainViews: Pick<ChainViewsService, "getActiveChainViewForNamespace" | "buildProviderMeta">;
  chainAddressCodecs: Pick<ChainAddressCodecRegistry, "formatAddress">;
  subscribeSessionLocked: StateChangeSubscription;
  subscribeAccountsStateChanged: StateChangeSubscription;
  subscribePermissionsStateChanged: StateChangeSubscription;
  subscribeNetworkStateChanged: StateChangeSubscription;
  subscribeNetworkPreferencesChanged: StateChangeSubscription;
  registerCleanup?: (cleanup: () => void) => void;
}): WalletDappConnections => {
  const {
    now = Date.now,
    sessionStatus,
    permissionViews,
    chainViews,
    chainAddressCodecs,
    subscribeSessionLocked,
    subscribeAccountsStateChanged,
    subscribePermissionsStateChanged,
    subscribeNetworkStateChanged,
    subscribeNetworkPreferencesChanged,
    registerCleanup,
  } = deps;

  const changed = createSignal<DappConnectionsState>();
  const connections = new Map<string, DappConnectionsRecord>();

  const normalizeConnectionOrigin = (origin: string): string => {
    const normalized = origin.trim();
    if (normalized.length === 0) {
      throw new Error("dappConnections origin is required");
    }
    return normalized;
  };

  const normalizeConnectionNamespace = (namespace: string): string => {
    const normalized = namespace.trim();
    if (normalized.length === 0) {
      throw new Error("dappConnections namespace is required");
    }
    return normalized;
  };

  const buildConnectionMapKey = (origin: string, namespace: string) => JSON.stringify([origin, namespace]);

  const findActiveChainRef = (namespace: string): ChainRef | null => {
    try {
      return buildProviderSnapshot({ sessionStatus, chainViews }, namespace).chain.chainRef;
    } catch {
      return null;
    }
  };

  const toConnectionRecord = (record: DappConnectionsRecord): DappConnectionRecord => ({
    origin: record.origin,
    namespace: record.namespace,
    chainRef: findActiveChainRef(record.namespace),
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
  });

  const buildStateSnapshot = (): DappConnectionsState => {
    const snapshot = [...connections.values()]
      .map((record) => toConnectionRecord(record))
      .sort(
        (left, right) =>
          left.connectedAt - right.connectedAt ||
          left.origin.localeCompare(right.origin) ||
          left.namespace.localeCompare(right.namespace),
      );

    return {
      connections: snapshot,
      count: snapshot.length,
    };
  };

  const emitChanged = () => {
    changed.emit(buildStateSnapshot());
  };

  const clearConnections = (): DappConnectionsState => {
    if (connections.size === 0) {
      return buildStateSnapshot();
    }

    connections.clear();
    const next = buildStateSnapshot();
    changed.emit(next);
    return next;
  };

  const buildConnectionPreview = (params: ProviderRuntimeConnectionQuery) => {
    const origin = normalizeConnectionOrigin(params.origin);
    const namespace = normalizeConnectionNamespace(params.namespace);

    return buildProviderConnectionState({
      providerProjection: {
        sessionStatus,
        chainViews,
      },
      permissionProjection: {
        sessionStatus,
        permissionViews,
        chainAddressCodecs,
      },
      origin,
      namespace,
    });
  };

  // Recheck live connections against the current provider-facing view.
  const pruneInactiveConnections = () => {
    let changedState = false;

    for (const record of [...connections.values()]) {
      const preview = buildConnectionPreview({
        origin: record.origin,
        namespace: record.namespace,
      });
      if (preview.accounts.length > 0) {
        continue;
      }

      connections.delete(buildConnectionMapKey(record.origin, record.namespace));
      changedState = true;
    }

    if (changedState) {
      emitChanged();
    }
  };

  const subscriptions = [
    subscribeSessionLocked(() => {
      clearConnections();
    }),
    subscribeAccountsStateChanged(() => {
      pruneInactiveConnections();
    }),
    subscribePermissionsStateChanged(() => {
      pruneInactiveConnections();
    }),
    subscribeNetworkStateChanged(() => {
      pruneInactiveConnections();
    }),
    subscribeNetworkPreferencesChanged(() => {
      pruneInactiveConnections();
    }),
  ];

  registerCleanup?.(() => {
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {}
    });
    connections.clear();
    changed.clear();
  });

  return {
    getState: () => buildStateSnapshot(),
    getConnection: (origin, options) => {
      const normalizedOrigin = normalizeConnectionOrigin(origin);
      const namespace = normalizeConnectionNamespace(options.namespace);
      const record = connections.get(buildConnectionMapKey(normalizedOrigin, namespace));
      return record ? toConnectionRecord(record) : null;
    },
    isConnected: (origin, options) => {
      const normalizedOrigin = normalizeConnectionOrigin(origin);
      const namespace = normalizeConnectionNamespace(options.namespace);
      return connections.has(buildConnectionMapKey(normalizedOrigin, namespace));
    },
    connect: (input) => {
      const origin = normalizeConnectionOrigin(input.origin);
      const namespace = normalizeConnectionNamespace(input.namespace);
      const preview = buildConnectionPreview({ origin, namespace });
      if (preview.accounts.length === 0) {
        return null;
      }

      const key = buildConnectionMapKey(origin, namespace);
      const existing = connections.get(key);
      const at = now();
      const next = {
        origin,
        namespace,
        connectedAt: existing?.connectedAt ?? at,
        updatedAt: at,
      };
      connections.set(key, next);
      emitChanged();
      return toConnectionRecord(next);
    },
    disconnect: (input) => {
      const origin = normalizeConnectionOrigin(input.origin);
      const namespace = normalizeConnectionNamespace(input.namespace);
      const removed = connections.delete(buildConnectionMapKey(origin, namespace));
      if (removed) {
        emitChanged();
      }
      return removed;
    },
    disconnectOrigin: (origin) => {
      const normalizedOrigin = normalizeConnectionOrigin(origin);
      const keys = [...connections.entries()]
        .filter(([, record]) => record.origin === normalizedOrigin)
        .map(([key]) => key);
      if (keys.length === 0) {
        return 0;
      }

      for (const key of keys) {
        connections.delete(key);
      }
      emitChanged();
      return keys.length;
    },
    clear: () => clearConnections(),
    buildConnectionProjection: (input): DappConnectionProjection => {
      const origin = normalizeConnectionOrigin(input.origin);
      const namespace = normalizeConnectionNamespace(input.namespace);
      const state = buildConnectionPreview({ origin, namespace });
      return {
        ...state,
        connected: connections.has(buildConnectionMapKey(origin, namespace)) && state.accounts.length > 0,
      };
    },
    listPermittedAccounts: (input) =>
      listFormattedPermittedAccounts(
        {
          sessionStatus,
          permissionViews,
          chainAddressCodecs,
        },
        input,
      ),
    onStateChanged: (listener) => changed.subscribe(listener),
  } satisfies WalletDappConnections;
};
