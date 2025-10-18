import type { MultiNamespaceAccountsState } from "../../controllers/account/types.js";
import type { ApprovalState } from "../../controllers/approval/types.js";
import type { NetworkState, PermissionsState, RpcEndpointState } from "../../controllers/index.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { AccountsSnapshot, NetworkSnapshot, PermissionsSnapshot, StoragePort } from "../../storage/index.js";
import {
  ACCOUNTS_SNAPSHOT_VERSION,
  APPROVALS_SNAPSHOT_VERSION,
  type ApprovalsSnapshot,
  NETWORK_SNAPSHOT_VERSION,
  PERMISSIONS_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
  type TransactionsSnapshot,
} from "../../storage/index.js";

type ControllersForSync = {
  network: { onStateChanged(handler: (state: NetworkState) => void): () => void };
  accounts: { onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void };
  permissions: { onPermissionsChanged(handler: (state: PermissionsState) => void): () => void };
  approvals: { onStateChanged(handler: (state: ApprovalState) => void): () => void };
  transactions: TransactionController;
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

  const subscriptions: Array<() => void> = [];

  const attach = () => {
    if (subscriptions.length > 0) return;
    const networkUnsub = controllers.network.onStateChanged((state) => {
      const envelope: NetworkSnapshot = {
        version: NETWORK_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          activeChain: state.activeChain,
          knownChains: state.knownChains.map((chain) => ({
            ...chain,
            rpcEndpoints: chain.rpcEndpoints.map((endpoint) => ({ ...endpoint })),
            blockExplorers: chain.blockExplorers
              ? chain.blockExplorers.map((explorer) => ({ ...explorer }))
              : undefined,
            icon: chain.icon ? { ...chain.icon } : undefined,
            features: chain.features ? [...chain.features] : undefined,
            tags: chain.tags ? [...chain.tags] : undefined,
            extensions: chain.extensions ? { ...chain.extensions } : undefined,
          })),
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

    const accountsUnsub = controllers.accounts.onStateChanged((state) => {
      const envelope: AccountsSnapshot = {
        version: ACCOUNTS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          namespaces: Object.fromEntries(
            Object.entries(state.namespaces).map(([namespace, snapshot]) => [
              namespace,
              { all: [...snapshot.all], primary: snapshot.primary },
            ]),
          ),
          active: state.active
            ? {
                namespace: state.active.namespace,
                chainRef: state.active.chainRef,
                address: state.active.address,
              }
            : null,
        },
      };

      void storagePort.saveSnapshot(StorageNamespaces.Accounts, envelope).catch((error) => {
        logger("[persistence] failed to persist accounts snapshot", error);
      });
    });

    subscriptions.push(accountsUnsub);

    const permissionsUnsub = controllers.permissions.onPermissionsChanged((state) => {
      const envelope: PermissionsSnapshot = {
        version: PERMISSIONS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          origins: Object.fromEntries(Object.entries(state.origins).map(([origin, scopes]) => [origin, [...scopes]])),
        },
      };
      void storagePort.saveSnapshot(StorageNamespaces.Permissions, envelope).catch((error) => {
        logger("[persistence] failed to persist permissions snapshot", error);
      });
    });
    subscriptions.push(permissionsUnsub);

    const approvalsUnsub = controllers.approvals.onStateChanged((state) => {
      const envelope: ApprovalsSnapshot = {
        version: APPROVALS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          pending: [...state.pending],
        },
      };

      void storagePort.saveSnapshot(StorageNamespaces.Approvals, envelope).catch((error) => {
        logger("[persistence] failed to persist approvals snapshot", error);
      });
    });

    subscriptions.push(approvalsUnsub);

    const transactionsUnsub = controllers.transactions.onStateChanged((state) => {
      const envelope: TransactionsSnapshot = {
        version: TRANSACTIONS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          pending: state.pending,
          history: state.history,
        },
      };

      void storagePort.saveSnapshot(StorageNamespaces.Transactions, envelope).catch((error) => {
        logger("[persistence] failed to persist transactions snapshot", error);
      });
    });

    subscriptions.push(transactionsUnsub);
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
