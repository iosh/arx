import type { NamespaceTransaction } from "./types.js";

export class NamespaceTransactions {
  #transactions: Map<string, NamespaceTransaction>;

  constructor(initial?: Iterable<[string, NamespaceTransaction]>) {
    this.#transactions = new Map(initial ?? []);
  }

  register(namespace: string, transaction: NamespaceTransaction, options?: { replace?: boolean }): void {
    const replace = options?.replace ?? false;
    if (!replace && this.#transactions.has(namespace)) {
      throw new Error(`Namespace transaction for namespace "${namespace}" already registered`);
    }
    this.#transactions.set(namespace, transaction);
  }

  unregister(namespace: string): void {
    this.#transactions.delete(namespace);
  }

  get(namespace: string): NamespaceTransaction | undefined {
    return this.#transactions.get(namespace);
  }

  listNamespaces(): string[] {
    return Array.from(this.#transactions.keys());
  }
}
