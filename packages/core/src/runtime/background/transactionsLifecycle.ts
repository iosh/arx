import type { TransactionRecovery } from "../../controllers/transaction/types.js";
import type { UnlockController } from "../../controllers/unlock/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";

export type TransactionsLifecycleOptions = {
  controller: TransactionRecovery;
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
        await options.controller.resumeTransactions();
      } catch (error) {
        logger("transactions: failed to resume transactions on initialize", error);
      }
    },
    start() {
      if (unsubscribe) return;

      unsubscribe = options.unlock.onUnlocked(() => {
        void options.controller.resumeTransactions().catch((error: unknown) => {
          logger("transactions: failed to resume transactions", error);
        });
      });

      if (options.unlock.isUnlocked()) {
        void options.controller.resumeTransactions().catch((error: unknown) => {
          logger("transactions: failed to resume transactions", error);
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
