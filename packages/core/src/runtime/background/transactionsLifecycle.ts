import type { TransactionController } from "../../controllers/transaction/types.js";
import type { UnlockController } from "../../controllers/unlock/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";

export type TransactionsLifecycleOptions = {
  controller: Pick<TransactionController, "resumePending">;
  service: Pick<TransactionsService, "list">;
  unlock: Pick<UnlockController, "onUnlocked" | "isUnlocked">;
  logger?: (message: string, error?: unknown) => void;
};

export type TransactionsLifecycle = {
  initialize(): Promise<void>;
  start(): void;
  destroy(): void;
};

export const createTransactionsLifecycle = (options: TransactionsLifecycleOptions): TransactionsLifecycle => {
  const logger = options.logger ?? (() => {});
  let unsubscribe: (() => void) | null = null;

  return {
    async initialize() {
      try {
        await options.controller.resumePending();
      } catch (error) {
        logger("transactions: failed to resume broadcast on initialize", error);
      }
    },
    start() {
      if (unsubscribe) return;

      unsubscribe = options.unlock.onUnlocked(() => {
        void options.controller.resumePending().catch((error) => {
          logger("transactions: failed to resume pending", error);
        });
      });

      if (options.unlock.isUnlocked()) {
        void options.controller.resumePending().catch((error) => {
          logger("transactions: failed to resume pending", error);
        });
      }
    },
    destroy() {
      if (!unsubscribe) return;
      try {
        unsubscribe();
      } catch {
        // best-effort
      } finally {
        unsubscribe = null;
      }
    },
  };
};
