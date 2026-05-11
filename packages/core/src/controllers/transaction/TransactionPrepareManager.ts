import { canPrepareProposal } from "./status.js";
import type { TransactionPrepareExecutionService } from "./TransactionPrepareExecutionService.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";

const DEFAULT_BACKGROUND_PREPARE_CONCURRENCY = 2;

type Options = {
  proposalStore: Pick<TransactionProposalStore, "peek" | "getPreparedForExecution">;
  execution: Pick<TransactionPrepareExecutionService, "prepareCurrentDraft">;
  logger?: (message: string, data?: unknown) => void;
  backgroundConcurrency?: number;
};

export class TransactionPrepareManager {
  #proposalStore: Pick<TransactionProposalStore, "peek" | "getPreparedForExecution">;
  #execution: Pick<TransactionPrepareExecutionService, "prepareCurrentDraft">;
  #logger: (message: string, data?: unknown) => void;

  #prepareInFlight: Map<string, { draftRevision: number; promise: Promise<void> }> = new Map();

  #prepareConcurrencyLimit: number;
  #prepareConcurrencyInUse = 0;
  #prepareConcurrencyWaiters: Array<() => void> = [];

  constructor(options: Options) {
    this.#proposalStore = options.proposalStore;
    this.#execution = options.execution;
    this.#logger = options.logger ?? (() => {});
    this.#prepareConcurrencyLimit = Math.max(
      1,
      options.backgroundConcurrency ?? DEFAULT_BACKGROUND_PREPARE_CONCURRENCY,
    );
  }

  queuePrepare(id: string) {
    void this.#prepareTransactionInBackground(id).catch((error) => {
      this.#logger("transactions: prepare failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async #prepareTransactionInBackground(id: string): Promise<void> {
    await this.#runPrepareUntilCurrent(id);
  }

  async #runPrepareUntilCurrent(id: string): Promise<void> {
    while (true) {
      const existing = this.#prepareInFlight.get(id);
      let settledDraftRevision: number;
      if (existing) {
        settledDraftRevision = existing.draftRevision;
        await existing.promise;
      } else {
        const initial = this.#proposalStore.peek(id);
        if (!initial) return;
        if (this.#hasCurrentPrepared(id) || !canPrepareProposal(initial)) {
          return;
        }
        settledDraftRevision = initial.draftRevision;

        const run = this.#withPrepareSlot(async () => {
          await this.#execution.prepareCurrentDraft(id);
        });
        const tracked = run
          .then(() => undefined)
          .finally(() => {
            this.#prepareInFlight.delete(id);
          });

        this.#prepareInFlight.set(id, {
          draftRevision: initial.draftRevision,
          promise: tracked,
        });
        await tracked;
      }

      const latest = this.#proposalStore.peek(id);
      if (!latest || this.#hasCurrentPrepared(id) || !canPrepareProposal(latest)) {
        return;
      }
      if (latest.draftRevision === settledDraftRevision) {
        return;
      }
    }
  }

  #hasCurrentPrepared(id: string): boolean {
    return this.#proposalStore.getPreparedForExecution(id) !== null;
  }

  async #withPrepareSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#prepareConcurrencyInUse >= this.#prepareConcurrencyLimit) {
      await new Promise<void>((resolve) => {
        this.#prepareConcurrencyWaiters.push(resolve);
      });
    } else {
      this.#prepareConcurrencyInUse += 1;
    }
    try {
      return await fn();
    } finally {
      const waiter = this.#prepareConcurrencyWaiters.shift();
      if (waiter) {
        waiter();
      } else {
        this.#prepareConcurrencyInUse = Math.max(0, this.#prepareConcurrencyInUse - 1);
      }
    }
  }
}
