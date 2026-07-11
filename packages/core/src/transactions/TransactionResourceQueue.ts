import type { TransactionResourceKey } from "./transactionNamespace.js";

type ResourceState = {
  tail: Promise<void>;
  pending: number;
};

/** Serializes finalization and submission for one namespace-owned resource. */
export class TransactionResourceQueue {
  readonly #resources = new Map<string, ResourceState>();

  async run<T>(key: TransactionResourceKey, operation: () => Promise<T>): Promise<T> {
    const token = JSON.stringify([key.kind, key.value]);
    const state = this.#resources.get(token) ?? { tail: Promise.resolve(), pending: 0 };
    const previous = state.tail;
    state.pending += 1;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.tail = previous.then(() => current);
    this.#resources.set(token, state);
    await previous;

    try {
      return await operation();
    } finally {
      release();
      state.pending -= 1;
      if (state.pending === 0) this.#resources.delete(token);
    }
  }
}
