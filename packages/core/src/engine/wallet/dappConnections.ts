import type { ProviderRuntimeConnectionQuery, ProviderRuntimeConnectionState } from "../../runtime/provider/types.js";
import { createSignal } from "../../services/store/_shared/signal.js";
import type { DappConnectionRecord, DappConnectionsState, WalletDappConnections } from "../types.js";

type DappConnectionsRecord = {
  origin: string;
  namespace: string;
  chainRef: DappConnectionRecord["chainRef"];
  connectedAt: number;
  updatedAt: number;
};

export type DappConnectionWriter = Readonly<{
  record(scope: ProviderRuntimeConnectionQuery, state: ProviderRuntimeConnectionState): DappConnectionRecord | null;
  remove(scope: ProviderRuntimeConnectionQuery): boolean;
}>;

export type WalletDappConnectionsController = WalletDappConnections & DappConnectionWriter;

export const createWalletDappConnections = (deps: { now?: () => number } = {}): WalletDappConnectionsController => {
  const { now = Date.now } = deps;
  const changed = createSignal<DappConnectionsState>();
  const connections = new Map<string, Map<string, DappConnectionsRecord>>();

  const readConnectionRecord = (origin: string, namespace: string): DappConnectionsRecord | null =>
    connections.get(origin)?.get(namespace) ?? null;

  const writeConnectionRecord = (record: DappConnectionsRecord) => {
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

  const toConnectionRecord = (record: DappConnectionsRecord): DappConnectionRecord => ({
    origin: record.origin,
    namespace: record.namespace,
    chainRef: record.chainRef,
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

  const recordConnection = (
    scope: ProviderRuntimeConnectionQuery,
    state: ProviderRuntimeConnectionState,
  ): DappConnectionRecord | null => {
    if (state.accounts.length === 0) {
      const removed = deleteConnectionRecord(scope.origin, scope.namespace);
      if (removed) {
        emitChanged();
      }
      return null;
    }

    const existing = readConnectionRecord(scope.origin, scope.namespace);
    const at = now();
    if (existing?.chainRef === state.snapshot.chain.chainRef) {
      return toConnectionRecord(existing);
    }

    const next: DappConnectionsRecord = {
      origin: scope.origin,
      namespace: scope.namespace,
      chainRef: state.snapshot.chain.chainRef,
      connectedAt: existing?.connectedAt ?? at,
      updatedAt: at,
    };
    writeConnectionRecord(next);
    emitChanged();
    return toConnectionRecord(next);
  };

  const removeConnection = (scope: ProviderRuntimeConnectionQuery): boolean => {
    const removed = deleteConnectionRecord(scope.origin, scope.namespace);
    if (removed) {
      emitChanged();
    }
    return removed;
  };

  return {
    getState: () => buildStateSnapshot(),
    getConnection: (origin, options) => {
      const record = readConnectionRecord(origin, options.namespace);
      return record ? toConnectionRecord(record) : null;
    },
    isConnected: (origin, options) => Boolean(readConnectionRecord(origin, options.namespace)),
    record: recordConnection,
    remove: removeConnection,
    onStateChanged: (listener) => changed.subscribe(listener),
  };
};
