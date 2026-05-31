import type { TransactionAggregate, TransactionAggregateStore, TransactionRestartAction } from "../aggregate/index.js";
import type { SubmittedTransactionTrackingService } from "../tracking/SubmittedTransactionTrackingService.js";

type TransactionRecoveryServiceDeps = {
  transactions: Pick<
    TransactionAggregateStore,
    "listRestartActions" | "cancelTransaction" | "expireTransaction" | "failTransaction"
  >;
  tracking: Pick<SubmittedTransactionTrackingService, "inspectSubmittedTransaction">;
};

export type TransactionRecoveryResult = {
  action: TransactionRestartAction;
  status: "applied" | "deferred" | "failed";
  aggregate: TransactionAggregate | null;
  error: unknown | null;
};

export class TransactionRecoveryService {
  #transactions: Pick<
    TransactionAggregateStore,
    "listRestartActions" | "cancelTransaction" | "expireTransaction" | "failTransaction"
  >;
  #tracking: Pick<SubmittedTransactionTrackingService, "inspectSubmittedTransaction">;

  constructor(deps: TransactionRecoveryServiceDeps) {
    this.#transactions = deps.transactions;
    this.#tracking = deps.tracking;
  }

  async recoverAfterRestart(): Promise<TransactionRecoveryResult[]> {
    const actions = await this.#transactions.listRestartActions();
    const results: TransactionRecoveryResult[] = [];

    for (const action of actions) {
      try {
        if (action.kind === "resume_tracking") {
          const tracking = await this.#tracking.inspectSubmittedTransaction(action.transactionId);
          results.push({
            action,
            status: tracking.status === "advanced" ? "applied" : "deferred",
            aggregate: tracking.aggregate,
            error: tracking.status === "retry_later" ? tracking.failure : null,
          });
          continue;
        }

        let aggregate = null;
        if (action.targetStatus === "cancelled") {
          aggregate = await this.#transactions.cancelTransaction({
            transactionId: action.transactionId,
            reason: action.reason,
          });
        } else if (action.targetStatus === "expired") {
          aggregate = await this.#transactions.expireTransaction({
            transactionId: action.transactionId,
            reason: action.reason,
          });
        } else {
          aggregate = await this.#transactions.failTransaction({
            transactionId: action.transactionId,
            reason: action.reason,
          });
        }

        results.push({
          action,
          status: "applied",
          aggregate,
          error: null,
        });
      } catch (error) {
        results.push({
          action,
          status: "failed",
          aggregate: null,
          error,
        });
      }
    }

    return results;
  }
}
