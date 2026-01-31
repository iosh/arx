import type { NetworkState, PermissionsState, RpcEndpointState } from "../../controllers/index.js";
import type { NetworkSnapshot, PermissionsSnapshot, StoragePort } from "../../storage/index.js";
import { NETWORK_SNAPSHOT_VERSION, PERMISSIONS_SNAPSHOT_VERSION, StorageNamespaces } from "../../storage/index.js";

type ControllersForSync = {
  network: { onStateChanged(handler: (state: NetworkState) => void): () => void };
  permissions: { onPermissionsChanged(handler: (state: PermissionsState) => void): () => void };
};

type RegisterStorageSyncOptions = {
  storage: StoragePort;
  controllers: ControllersForSync;
  now?: () => number;
  logger?: (message: string, error: unknown) => void;
};

export const createStorageSync = ({
  storage: storagePort,
  controllers,
  now = Date.now,
  logger = console.warn,
}: RegisterStorageSyncOptions) => {
  const cloneRpcEndpointState = (state: RpcEndpointState): RpcEndpointState => ({
    activeIndex: state.activeIndex,
    endpoints: state.endpoints.map((endpoint) => ({
      index: endpoint.index,
      url: endpoint.url,
      type: endpoint.type,
      weight: endpoint.weight,
      headers: endpoint.headers ? { ...endpoint.headers } : undefined,
    })),
    health: state.health.map((entry) => ({
      index: entry.index,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError ? { ...entry.lastError } : undefined,
      lastFailureAt: entry.lastFailureAt,
      cooldownUntil: entry.cooldownUntil,
    })),
    strategy: {
      id: state.strategy.id,
      options: state.strategy.options ? { ...state.strategy.options } : undefined,
    },
    lastUpdatedAt: state.lastUpdatedAt,
  });

  const clonePermissionsState = (state: PermissionsState): PermissionsState => ({
    origins: Object.fromEntries(
      Object.entries(state.origins).map(([origin, originState]) => [
        origin,
        Object.fromEntries(
          Object.entries(originState).map(([namespace, namespaceState]) => [
            namespace,
            {
              scopes: [...namespaceState.scopes],
              chains: [...namespaceState.chains],
              ...(namespaceState.accountsByChain
                ? {
                    accountsByChain: Object.fromEntries(
                      Object.entries(namespaceState.accountsByChain).map(([chainRef, accounts]) => [
                        chainRef,
                        [...accounts],
                      ]),
                    ),
                  }
                : {}),
            },
          ]),
        ),
      ]),
    ),
  });

  const subscriptions: Array<() => void> = [];

  const attach = () => {
    if (subscriptions.length > 0) return;
    const networkUnsub = controllers.network.onStateChanged((state) => {
      const envelope: NetworkSnapshot = {
        version: NETWORK_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          rpc: Object.fromEntries(
            Object.entries(state.rpc).map(([chainRef, endpointState]) => [
              chainRef,
              cloneRpcEndpointState(endpointState),
            ]),
          ),
        },
      };

      void storagePort.saveSnapshot(StorageNamespaces.Network, envelope).catch((error) => {
        logger("[persistence] failed to persist network snapshot", error);
      });
    });

    subscriptions.push(networkUnsub);

    const permissionsUnsub = controllers.permissions.onPermissionsChanged((state) => {
      const envelope: PermissionsSnapshot = {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: clonePermissionsState(state),
      };
      void storagePort.saveSnapshot(StorageNamespaces.Permissions, envelope).catch((error) => {
        logger("[persistence] failed to persist permissions snapshot", error);
      });
    });

    subscriptions.push(permissionsUnsub);
  };

  const detach = () => {
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        logger("[persistence] failed to unsubscribe storage sync listener", error);
      }
    });
  };

  return { attach, detach };
};
