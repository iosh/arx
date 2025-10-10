import type { ApprovalState } from "../../controllers/approval/types.js";
import type { NetworkState } from "../../controllers/index.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { NetworkSnapshot, StoragePort } from "../../storage/index.js";
import {
  APPROVALS_SNAPSHOT_VERSION,
  type ApprovalsSnapshot,
  NETWORK_SNAPSHOT_VERSION,
  StorageNamespaces,
  TRANSACTIONS_SNAPSHOT_VERSION,
  type TransactionsSnapshot,
} from "../../storage/index.js";

type ControllersForSync = {
  network: {
    onStateChanged(handler: (state: NetworkState) => void): () => void;
  };
  approvals: {
    onStateChanged(handler: (state: ApprovalState) => void): () => void;
  };
  transactions: TransactionController;
};

type RegisterStorageSyncOptions = {
  storage: StoragePort;
  controllers: ControllersForSync;
  now?: () => number;
  logger?: (message: string, error: unknown) => void;
};

export const registerStorageSync = ({
  storage,
  controllers,
  now = Date.now,
  logger = console.warn,
}: RegisterStorageSyncOptions): (() => void) => {
  const subscriptions: Array<() => void> = [];

  subscriptions.push(
    controllers.network.onStateChanged((state) => {
      const envelope: NetworkSnapshot = {
        version: NETWORK_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          active: { ...state.active },
          knownChains: state.knownChains.map((chain) => ({ ...chain })),
        },
      };

      void storage.saveSnapshot(StorageNamespaces.Network, envelope).catch((error) => {
        logger("[persistence] failed to persist network snapshot", error);
      });
    }),
  );

  subscriptions.push(
    controllers.approvals.onStateChanged((state) => {
      const envelope: ApprovalsSnapshot = {
        version: APPROVALS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          pending: [...state.pending],
        },
      };

      void storage.saveSnapshot(StorageNamespaces.Approvals, envelope).catch((error) => {
        logger("[persistence] failed to persist approvals snapshot", error);
      });
    }),
  );

  subscriptions.push(
    controllers.transactions.onStateChanged((state) => {
      const envelope: TransactionsSnapshot = {
        version: TRANSACTIONS_SNAPSHOT_VERSION,
        updatedAt: now(),
        payload: {
          pending: state.pending,
          history: state.history,
        },
      };

      void storage.saveSnapshot(StorageNamespaces.Transactions, envelope).catch((error) => {
        logger("[persistence] failed to persist transactions snapshot", error);
      });
    }),
  );

  return () => {
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        logger("[persistence] failed to unsubscribe storage sync listener", error);
      }
    });
  };
};
