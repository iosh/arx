import type { TransactionController } from "../../controllers/transaction/types.js";
import type { UnlockController } from "../../controllers/unlock/types.js";
import type { TransactionsService } from "../../services/transactions/types.js";

export type TransactionsLifecycleOptions = {
  controller: Pick<TransactionController, "resumePending">;
  service: Pick<TransactionsService, "failAllPending">;
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

  const resume = (includeSigning: boolean) => {
    void options.controller.resumePending({ includeSigning }).catch((error) => {
      logger("transactions: failed to resume pending", error);
    });
  };

  return {
    async initialize() {
      try {
        await options.service.failAllPending({ reason: "session_lost" });
      } catch (error) {
        logger("transactions: failed to cleanup pending on initialize", error);
      }

      try {
        await options.controller.resumePending({ includeSigning: false });
      } catch (error) {
        logger("transactions: failed to resume broadcast on initialize", error);
      }
    },
    start() {
      if (unsubscribe) return;

      unsubscribe = options.unlock.onUnlocked(() => {
        resume(true);
      });

      if (options.unlock.isUnlocked()) {
        resume(true);
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
