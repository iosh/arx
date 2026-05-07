import type {
  TransactionSubmissionFailure,
  TransactionSubmissionPersistenceFailure,
  TransactionSubmissionResolution,
  TransactionSubmissionTracker,
} from "./types.js";
import { TransactionSubmissionError } from "./types.js";

type TransactionSubmissionStoreOptions = {
  stateLimit: number;
};

type SubmissionWaiter = {
  resolve: (value: TransactionSubmissionResolution) => void;
  reject: (reason: Error) => void;
};

type SubmissionOutcome =
  | { state: "submitted"; resolution: TransactionSubmissionResolution }
  | { state: "failed"; failure: TransactionSubmissionFailure };

export class TransactionSubmissionStore implements TransactionSubmissionTracker {
  #outcomes = new Map<string, SubmissionOutcome>();
  #waiters = new Map<string, Set<SubmissionWaiter>>();
  #stateLimit: number;

  constructor(options: TransactionSubmissionStoreOptions) {
    this.#stateLimit = options.stateLimit;
  }

  recordSubmitted(id: string, resolution: TransactionSubmissionResolution): void {
    this.#cacheOutcome(id, {
      state: "submitted",
      resolution: structuredClone(resolution),
    });
    this.#flushWaiters(id);
  }

  recordPersistenceFailure(id: string, failure: TransactionSubmissionPersistenceFailure): void {
    const current = this.#outcomes.get(id);
    if (current?.state !== "submitted") {
      return;
    }

    this.#cacheOutcome(id, {
      state: "submitted",
      resolution: {
        ...structuredClone(current.resolution),
        persistenceFailure: structuredClone(failure),
      },
    });
    this.#flushWaiters(id);
  }

  recordFailure(id: string, failure: TransactionSubmissionFailure): void {
    this.#cacheOutcome(id, {
      state: "failed",
      failure: structuredClone(failure),
    });
    this.#flushWaiters(id);
  }

  async waitForSubmissionOutcome(id: string): Promise<TransactionSubmissionResolution> {
    const cached = this.#outcomes.get(id);
    if (cached) {
      return this.#readOutcomeOrThrow(cached);
    }

    return await new Promise<TransactionSubmissionResolution>((resolve, reject) => {
      const waiter: SubmissionWaiter = { resolve, reject };
      const existing = this.#waiters.get(id);
      if (existing) {
        existing.add(waiter);
      } else {
        this.#waiters.set(id, new Set([waiter]));
      }

      const outcome = this.#outcomes.get(id);
      if (outcome) {
        this.#settleWaiter(waiter, outcome);
        this.#deleteWaiter(id, waiter);
      }
    });
  }

  #readOutcomeOrThrow(outcome: SubmissionOutcome): TransactionSubmissionResolution {
    if (outcome.state === "submitted") {
      return structuredClone(outcome.resolution);
    }

    throw new TransactionSubmissionError(outcome.failure);
  }

  #cacheOutcome(id: string, outcome: SubmissionOutcome): void {
    this.#outcomes.delete(id);
    this.#outcomes.set(id, structuredClone(outcome));

    while (this.#outcomes.size > this.#stateLimit) {
      const oldest = this.#outcomes.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.#outcomes.delete(oldest);
    }
  }

  #flushWaiters(id: string): void {
    const waiters = this.#waiters.get(id);
    const outcome = this.#outcomes.get(id);
    if (!waiters || !outcome) {
      return;
    }

    this.#waiters.delete(id);
    for (const waiter of waiters) {
      this.#settleWaiter(waiter, outcome);
    }
  }

  #settleWaiter(waiter: SubmissionWaiter, outcome: SubmissionOutcome): void {
    if (outcome.state === "submitted") {
      waiter.resolve(structuredClone(outcome.resolution));
      return;
    }

    waiter.reject(new TransactionSubmissionError(outcome.failure));
  }

  #deleteWaiter(id: string, waiter: SubmissionWaiter): void {
    const waiters = this.#waiters.get(id);
    if (!waiters) {
      return;
    }

    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.#waiters.delete(id);
    }
  }
}
