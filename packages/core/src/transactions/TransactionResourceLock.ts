import type { TransactionApprovalResourceKey } from "./namespace/types.js";

type LockState = {
  tail: Promise<void>;
  pending: number;
};

export class TransactionResourceLock {
  #locks = new Map<string, LockState>();

  async withKey<T>(resourceKey: TransactionApprovalResourceKey | null, run: () => Promise<T>): Promise<T> {
    if (!resourceKey) {
      return await run();
    }

    return await this.withToken(`${resourceKey.kind}:${resourceKey.value}`, run);
  }

  async withToken<T>(token: string, run: () => Promise<T>): Promise<T> {
    const state = this.#locks.get(token) ?? {
      tail: Promise.resolve(),
      pending: 0,
    };
    const previous = state.tail;
    state.pending += 1;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.tail = previous.then(() => current);
    this.#locks.set(token, state);

    await previous;

    try {
      return await run();
    } finally {
      release();
      state.pending -= 1;
      if (state.pending === 0) {
        this.#locks.delete(token);
      }
    }
  }
}
