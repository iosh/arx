import type { ChainRef } from "../../chains/ids.js";
import type { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { ProviderRuntimeConnectionQuery } from "../../runtime/provider/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { PermissionViewsService } from "../../services/runtime/permissionViews/types.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import { createSignal, type StateChangeSubscription } from "../../services/store/_shared/signal.js";
import type { ProviderChainSelectionService } from "../../services/store/providerChainSelection/types.js";
import type {
  DappConnectionRecord,
  DappConnectionsState,
  DappConnectionView,
  WalletDappConnections,
} from "../types.js";
import {
  buildProviderConnectionState,
  buildProviderSnapshot,
  listFormattedPermittedAccounts,
} from "./providerSnapshot.js";

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
  chainViews: Pick<ChainViewsService, "findAvailableChainView">;
  providerChainSelection: Pick<ProviderChainSelectionService, "getSelectedChainRef">;
  chainAddressCodecs: Pick<ChainAddressCodecRegistry, "formatAddress">;
  subscribeSessionLocked: StateChangeSubscription;
  subscribeAccountsStateChanged: StateChangeSubscription;
  subscribePermissionsStateChanged: StateChangeSubscription;
  subscribeNetworkStateChanged: StateChangeSubscription;
  subscribeProviderChainChanged: StateChangeSubscription;
}): WalletDappConnections => {
  const {
    now = Date.now,
    sessionStatus,
    permissionViews,
    chainViews,
    providerChainSelection,
    chainAddressCodecs,
    subscribeSessionLocked,
    subscribeAccountsStateChanged,
    subscribePermissionsStateChanged,
    subscribeNetworkStateChanged,
    subscribeProviderChainChanged,
  } = deps;

  const changed = createSignal<DappConnectionsState>();
  const connections = new Map<string, Map<string, DappConnectionsRecord>>();

  const parseConnectionOrigin = (origin: string): string => {
    if (origin.length === 0 || origin.trim() !== origin) {
      throw new Error("dappConnections origin is required");
    }
    return origin;
  };

  const parseConnectionNamespace = (namespace: string): string => {
    const namespaceKey = namespace.trim();
    if (namespaceKey.length === 0) {
      throw new Error("dappConnections namespace is required");
    }
    return namespaceKey;
  };

  const getConnectionRecord = (origin: string, namespace: string): DappConnectionsRecord | null =>
    connections.get(origin)?.get(namespace) ?? null;

  const hasConnectionRecord = (origin: string, namespace: string): boolean =>
    connections.get(origin)?.has(namespace) ?? false;

  const setConnectionRecord = (record: DappConnectionsRecord) => {
    let recordsByNamespace = connections.get(record.origin);
    if (!recordsByNamespace) {
      recordsByNamespace = new Map();
      connections.set(record.origin, recordsByNamespace);
    }
    recordsByNamespace.set(record.namespace, record);
  };

  const deleteConnectionRecord = (origin: string, namespace: string): boolean => {
    const recordsByNamespace = connections.get(origin);
    if (!recordsByNamespace) {
      return false;
    }

    const removed = recordsByNamespace.delete(namespace);
    if (recordsByNamespace.size === 0) {
      connections.delete(origin);
    }
    return removed;
  };

  const listConnectionRecords = (): DappConnectionsRecord[] => {
    const records: DappConnectionsRecord[] = [];
    for (const recordsByNamespace of connections.values()) {
      records.push(...recordsByNamespace.values());
    }
    return records;
  };

  const getActiveChainRef = (origin: string, namespace: string): ChainRef => {
    return buildProviderSnapshot({ sessionStatus, chainViews, providerChainSelection }, { origin, namespace }).chain
      .chainRef;
  };

  const toConnectionRecord = (record: DappConnectionsRecord): DappConnectionRecord => ({
    origin: record.origin,
    namespace: record.namespace,
    chainRef: getActiveChainRef(record.origin, record.namespace),
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
  });

  const buildStateSnapshot = (): DappConnectionsState => {
    const snapshot = listConnectionRecords()
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
    const origin = parseConnectionOrigin(params.origin);
    const namespace = parseConnectionNamespace(params.namespace);

    return buildProviderConnectionState({
      providerSnapshot: {
        sessionStatus,
        chainViews,
        providerChainSelection,
      },
      accountAccess: {
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

    for (const record of listConnectionRecords()) {
      const preview = buildConnectionPreview({
        origin: record.origin,
        namespace: record.namespace,
      });
      if (preview.accounts.length > 0) {
        continue;
      }

      deleteConnectionRecord(record.origin, record.namespace);
      changedState = true;
    }

    if (changedState) {
      emitChanged();
    }
  };

  subscribeSessionLocked(() => {
    clearConnections();
  });
  subscribeAccountsStateChanged(() => {
    pruneInactiveConnections();
  });
  subscribePermissionsStateChanged(() => {
    pruneInactiveConnections();
  });
  subscribeNetworkStateChanged(() => {
    pruneInactiveConnections();
  });
  subscribeProviderChainChanged(() => {
    pruneInactiveConnections();
  });

  return {
    getState: () => buildStateSnapshot(),
    getConnection: (origin, options) => {
      const parsedOrigin = parseConnectionOrigin(origin);
      const namespace = parseConnectionNamespace(options.namespace);
      const record = getConnectionRecord(parsedOrigin, namespace);
      return record ? toConnectionRecord(record) : null;
    },
    isConnected: (origin, options) => {
      const parsedOrigin = parseConnectionOrigin(origin);
      const namespace = parseConnectionNamespace(options.namespace);
      return hasConnectionRecord(parsedOrigin, namespace);
    },
    connect: (input) => {
      const origin = parseConnectionOrigin(input.origin);
      const namespace = parseConnectionNamespace(input.namespace);
      const preview = buildConnectionPreview({ origin, namespace });
      if (preview.accounts.length === 0) {
        return null;
      }

      const existing = getConnectionRecord(origin, namespace);
      const at = now();
      const next = {
        origin,
        namespace,
        connectedAt: existing?.connectedAt ?? at,
        updatedAt: at,
      };
      setConnectionRecord(next);
      emitChanged();
      return toConnectionRecord(next);
    },
    disconnect: (input) => {
      const origin = parseConnectionOrigin(input.origin);
      const namespace = parseConnectionNamespace(input.namespace);
      const removed = deleteConnectionRecord(origin, namespace);
      if (removed) {
        emitChanged();
      }
      return removed;
    },
    disconnectOrigin: (origin) => {
      const parsedOrigin = parseConnectionOrigin(origin);
      const recordsByNamespace = connections.get(parsedOrigin);
      const removed = recordsByNamespace?.size ?? 0;
      if (removed === 0) {
        return 0;
      }

      connections.delete(parsedOrigin);
      emitChanged();
      return removed;
    },
    clear: () => clearConnections(),
    getConnectionState: (input): DappConnectionView => {
      const origin = parseConnectionOrigin(input.origin);
      const namespace = parseConnectionNamespace(input.namespace);
      const state = buildConnectionPreview({ origin, namespace });
      return {
        ...state,
        connected: hasConnectionRecord(origin, namespace) && state.accounts.length > 0,
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
