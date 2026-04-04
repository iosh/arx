import type { TransactionController } from "../../controllers/transaction/types.js";
import type { UnlockController } from "../../controllers/unlock/types.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";

export type TransactionsLifecycleOptions = {
  controller: Pick<TransactionController, "resumePending">;
  service: Pick<TransactionsService, "failAllPending" | "list">;
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
  let coldStartRetainedExecutionIds = new Set<string>();

  const resume = (includeSigning: boolean) => {
    void options.controller
      .resumePending({
        includeSigning,
        ...(coldStartRetainedExecutionIds.size > 0 ? { skipExecutionIds: [...coldStartRetainedExecutionIds] } : {}),
      })
      .catch((error) => {
        logger("transactions: failed to resume pending", error);
      });
  };

  const listPendingExecutionIds = async (status: "approved" | "signed"): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: { createdAt: number; id: string } | undefined;

    while (true) {
      const page = await options.service.list({
        status,
        limit: 200,
        ...(cursor ? { before: cursor } : {}),
      });

      if (page.length === 0) {
        return ids;
      }

      ids.push(...page.map((record) => record.id));
      const tail = page.at(-1);
      cursor = tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
      if (!cursor) {
        return ids;
      }
    }
  };

  return {
    async initialize() {
      coldStartRetainedExecutionIds = new Set();

      try {
        await options.service.failAllPending({ reason: "session_lost" });
      } catch (error) {
        logger("transactions: failed to cleanup pending on initialize", error);
      }

      try {
        for (const id of await listPendingExecutionIds("approved")) {
          coldStartRetainedExecutionIds.add(id);
        }
        for (const id of await listPendingExecutionIds("signed")) {
          coldStartRetainedExecutionIds.add(id);
        }
      } catch (error) {
        logger("transactions: failed to capture cold-start execution boundary", error);
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
        coldStartRetainedExecutionIds.clear();
      }
    },
  };
};
