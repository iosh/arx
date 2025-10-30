import type { TransactionAdapter } from "./types.js";

export class TransactionAdapterRegistry {
  #adapters: Map<string, TransactionAdapter>;

  constructor(initial?: Iterable<[string, TransactionAdapter]>) {
    this.#adapters = new Map(initial ?? []);
  }

  register(namespace: string, adapter: TransactionAdapter): void {
    this.#adapters.set(namespace, adapter);
  }

  unregister(namespace: string): void {
    this.#adapters.delete(namespace);
  }

  get(namespace: string): TransactionAdapter | undefined {
    return this.#adapters.get(namespace);
  }

  listNamespaces(): string[] {
    return Array.from(this.#adapters.keys());
  }
}
