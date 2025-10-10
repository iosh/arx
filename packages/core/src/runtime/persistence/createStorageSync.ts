import type { ApprovalState } from "../../controllers/approval/types.js";
import type { AccountsState, NetworkState, PermissionsState } from "../../controllers/index.js";
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
  accounts: { onAccountsChanged(handler: (state: AccountsState) => void): () => void };
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
  const subscriptions: Array<() => void> = [];

  const attach = () => {
    if (subscriptions.length > 0) return;
    const networkUnsub = controllers.network.onStateChanged((state) => {
      const envelope: NetworkSnapshot = {
        version: NETWORK_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          active: { ...state.active },
          knownChains: state.knownChains.map((chain) => ({ ...chain })),
        },
      };

      void storagePort.saveSnapshot(StorageNamespaces.Network, envelope).catch((error) => {
        logger("[persistence] failed to persist network snapshot", error);
      });
    });

    subscriptions.push(networkUnsub);
    const accountsUnsub = controllers.accounts.onAccountsChanged((state) => {
      const envelope: AccountsSnapshot = {
        version: ACCOUNTS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          all: [...state.all],
          primary: state.primary,
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
